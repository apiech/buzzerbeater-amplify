import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  __testing as lineupHelperTesting,
  getLineupHelperWorkspace,
  optimizeLineupHelper,
} from "../amplify/data/_backend/lineup-helper";
import {
  WORKSPACE_CACHE_VERSION,
  buildWorkspaceCachePayload,
  readWorkspaceCachePayload,
} from "../amplify/data/_backend/workspace-cache";
import type {
  BBApiOwnedRosterPlayer,
  BBApiOwnedRosterPlayerSkills,
} from "../lib/bbapi";
import {
  __testing as workspaceTesting,
  buildSalaryProjectionPayload,
  buildScoutWorkspace,
  getPlayerTrend,
  lookupSharedPlayerCardByToken,
  repairOwnerRosterData,
  revokePlayerCard,
} from "../amplify/data/_backend/workspace";
import {
  createWorkspaceCacheConnection,
  createWorkspaceCachePayload,
} from "./fixtures/owned-data";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const workspaceSource = readFileSync(
  join(repoRoot, "amplify", "data", "_backend", "workspace.ts"),
  "utf8",
);
const refreshWorkspaceHandlerSource = readFileSync(
  join(repoRoot, "amplify", "data", "refresh-workspace", "handler.ts"),
  "utf8",
);
const connectAccountHandlerSource = readFileSync(
  join(repoRoot, "amplify", "data", "connect-bb-account", "handler.ts"),
  "utf8",
);
const homeWorkspaceHandlerSource = readFileSync(
  join(repoRoot, "amplify", "data", "get-home-workspace", "handler.ts"),
  "utf8",
);
const scoutTeamSummaryHandlerSource = readFileSync(
  join(repoRoot, "amplify", "data", "get-scout-team-summary", "handler.ts"),
  "utf8",
);
const scoutScheduleHandlerSource = readFileSync(
  join(repoRoot, "amplify", "data", "get-scout-schedule", "handler.ts"),
  "utf8",
);
const lineupHelperSource = readFileSync(
  join(repoRoot, "amplify", "data", "_backend", "lineup-helper.ts"),
  "utf8",
);
const nextGameRecommendationSource = readFileSync(
  join(
    repoRoot,
    "amplify",
    "data",
    "_backend",
    "next-game-recommendation.ts",
  ),
  "utf8",
);
const opponentForecastSource = readFileSync(
  join(repoRoot, "amplify", "data", "_backend", "opponent-forecast.ts"),
  "utf8",
);
const workspaceLoggingSource = readFileSync(
  join(
    repoRoot,
    "amplify",
    "data",
    "_backend",
    "workspace-request-logging.ts",
  ),
  "utf8",
);
const dashboardAppSource = readFileSync(
  join(repoRoot, "app", "dashboard-app.tsx"),
  "utf8",
);
const authenticatedWorkspaceHookSource = readFileSync(
  join(repoRoot, "app", "dashboard", "use-authenticated-workspace.ts"),
  "utf8",
);
const scoutTeamSummarySection =
  workspaceSource.match(
    /export async function getScoutTeamSummaryForTeamWithMeta[\s\S]*?export async function getScoutScheduleForTeam/,
  )?.[0] ?? "";
const scoutScheduleSection =
  workspaceSource.match(
    /export async function getScoutScheduleForTeamWithMeta[\s\S]*?export async function lookupSharedPlayerCardByToken/,
  )?.[0] ?? "";
const syncWorkspaceSection =
  workspaceSource.match(
    /async function syncWorkspace[\s\S]*?async function persistWorkspace/,
  )?.[0] ?? "";

test("buildScoutWorkspace includes arbitrary scout targets, league options, and matchup history", () => {
  const currentWorkspace = {
    teamInfo: {
      teamId: "OUR",
      teamName: "Our Team",
    },
    standings: {
      league: { id: "L1", name: "League One" },
      conferences: [
        {
          index: 0,
          teams: [
            {
              id: "OUR",
              teamName: "Our Team",
              wins: 12,
              losses: 4,
              pf: 100,
              pa: 90,
            },
            {
              id: "OPP",
              teamName: "Opp Team",
              wins: 10,
              losses: 6,
              pf: 98,
              pa: 95,
            },
            {
              id: "ALT",
              teamName: "Alt Team",
              wins: 8,
              losses: 8,
              pf: 90,
              pa: 91,
            },
          ],
        },
      ],
    },
    schedule: {
      matches: [
        {
          id: "m1",
          startTime: "2026-03-01T20:00:00.000Z",
          type: "League",
          homeTeam: { id: "OUR", teamName: "Our Team", score: 102 },
          awayTeam: { id: "OPP", teamName: "Opp Team", score: 96 },
        },
      ],
    },
  } as any;

  const currentBoxScores = [{ matchId: "m1" }] as any;
  const opponentWorkspace = {
    teamInfo: { teamId: "OPP", teamName: "Opp Team" },
    roster: { players: [] },
    teamStats: null,
    nextMatch: null,
    recentMatches: [
      {
        id: "m1",
        startTime: "2026-03-01T20:00:00.000Z",
        type: "League",
        homeTeam: { id: "OUR", teamName: "Our Team", score: 102 },
        awayTeam: { id: "OPP", teamName: "Opp Team", score: 96 },
      },
    ],
    recentBoxScores: [
      {
        matchId: "m1",
        homeTeam: {
          id: "OUR",
          teamName: "Our Team",
          offStrategy: "Base",
          defStrategy: "ManToMan",
        },
        awayTeam: {
          id: "OPP",
          teamName: "Opp Team",
          offStrategy: "Push",
          defStrategy: "23Zone",
        },
      },
    ],
  } as any;

  const scout = buildScoutWorkspace(
    currentWorkspace,
    currentBoxScores,
    opponentWorkspace,
    "OPP",
    "2026-03-15T00:00:00.000Z",
  ) as {
    teamId: string;
    availableOpponents: Array<{ teamId: string }>;
    recentMatchups: Array<{ matchId: string; hasBoxscore: boolean }>;
    summary: {
      record: { wins: number; losses: number };
      recentGames: Array<{ matchId: string; hasBoxscore: boolean }>;
    };
  };

  assert.equal(scout.teamId, "OPP");
  assert.equal(scout.availableOpponents.length, 2);
  assert.deepStrictEqual(
    scout.availableOpponents.map((team) => team.teamId),
    ["ALT", "OPP"],
  );
  const firstRecentMatchup = scout.recentMatchups[0];
  const firstRecentGame = scout.summary.recentGames[0];
  assert.ok(firstRecentMatchup);
  assert.ok(firstRecentGame);
  assert.equal(firstRecentMatchup.matchId, "m1");
  assert.equal(firstRecentMatchup.hasBoxscore, true);
  assert.equal(scout.summary.record.wins, 10);
  assert.equal(firstRecentGame.hasBoxscore, true);
});

test("workspace sync stays cache-first unless a force refresh is requested", () => {
  const connection = {
    userId: "user-1",
    bbLoginName: "coach",
    status: "CONNECTED",
    lastSyncAt: "2020-03-15T00:00:00.000Z",
    workspaceCacheJson: createWorkspaceCachePayload(),
  } as any;

  const cachedWorkspace = workspaceTesting.readCachedWorkspace(connection);
  assert.notEqual(cachedWorkspace, null);
  assert.equal(
    workspaceTesting.shouldSyncWorkspace({
      force: false,
      cachedWorkspace,
    }),
    false,
  );
  assert.equal(
    workspaceTesting.shouldSyncWorkspace({
      force: true,
      cachedWorkspace,
    }),
    true,
  );
  assert.equal(
    workspaceTesting.shouldSyncWorkspace({
      force: false,
      cachedWorkspace: null,
    }),
    true,
  );
});

test("workspace cache version mismatches force a refresh", () => {
  const connection = {
    userId: "user-1",
    bbLoginName: "coach",
    status: "CONNECTED",
    lastSyncAt: "2020-03-15T00:00:00.000Z",
    workspaceCacheJson: {
      ...createWorkspaceCachePayload(),
      version: WORKSPACE_CACHE_VERSION - 1,
    },
  } as any;

  const cachedWorkspace = workspaceTesting.readCachedWorkspace(connection);
  assert.equal(cachedWorkspace, null);
  assert.equal(
    workspaceTesting.shouldSyncWorkspace({
      force: false,
      cachedWorkspace,
    }),
    true,
  );
});

test("workspace cache rows missing arena are treated as unreadable cache misses", () => {
  const cache = readWorkspaceCachePayload({
    version: WORKSPACE_CACHE_VERSION,
    home: {},
    teamHub: {},
    scout: {},
    leagueIntel: {},
    playerLab: {},
  });

  assert.equal(cache, null);
});

test("readCachedWorkspace rehydrates the home connection without raw storage fields", () => {
  const connection = {
    userId: "user-1",
    bbLoginName: "coach",
    status: "CONNECTED",
    teamName: null,
    shortName: "Visionaries",
    lastSyncAt: "2026-03-15T00:00:00.000Z",
    workspaceCacheJson: createWorkspaceCachePayload({
      home: {
        connection: createWorkspaceCacheConnection({
          teamName: "Cached Visionaries",
        }),
      },
    }),
  } as any;

  const cachedWorkspace = workspaceTesting.readCachedWorkspace(connection);

  assert.ok(cachedWorkspace);
  assert.equal(cachedWorkspace.connectionRecord.userId, "user-1");
  assert.equal(cachedWorkspace.home.connection.teamName, "Cached Visionaries");
  assert.equal(
    "userId" in (cachedWorkspace.home.connection as Record<string, unknown>),
    false,
  );
  assert.equal(
    "shortName" in (cachedWorkspace.home.connection as Record<string, unknown>),
    false,
  );
  assert.equal(
    "workspaceCacheJson" in
      (cachedWorkspace.home.connection as Record<string, unknown>),
    false,
  );
});

test("league intel cache rehydrates persisted comparisons and refresh checks honor newer syncs", () => {
  const connection = {
    bbLoginName: "coach",
    lastSyncAt: "2026-04-19T12:30:00.000Z",
    status: "CONNECTED",
    teamId: "team-1",
    userId: "user-1",
    workspaceCacheJson: createWorkspaceCachePayload({
      leagueIntel: {
        comparisons: {
          arena: [],
          builtAt: "2026-04-19T12:00:00.000Z",
          defense: [],
          incompleteTeamCount: 0,
          offense: [],
          payroll: [],
          season: 72,
        },
        league: {
          id: "1000",
          name: "NBBA",
        },
        standings: [],
      },
    }),
  } as any;

  const cachedWorkspace = workspaceTesting.readCachedWorkspace(connection);

  assert.ok(cachedWorkspace?.leagueIntel.comparisons);
  assert.equal(cachedWorkspace.leagueIntel.comparisons.season, 72);
  assert.equal(
    workspaceTesting.shouldRefreshLeagueComparisons({
      comparisons: cachedWorkspace.leagueIntel.comparisons ?? null,
      force: false,
      lastSyncAt: "2026-04-19T12:30:00.000Z",
    }),
    true,
  );
  assert.equal(
    workspaceTesting.shouldRefreshLeagueComparisons({
      comparisons: cachedWorkspace.leagueIntel.comparisons ?? null,
      force: false,
      lastSyncAt: "2026-04-19T11:30:00.000Z",
    }),
    false,
  );
});

test("repairOwnerRosterData upserts owner snapshots and patches only the cached team-hub roster", async () => {
  const existingCache = createWorkspaceCachePayload({
    teamHub: {
      roster: [
        {
          age: 26,
          bestPosition: "PG",
          dmi: 1500,
          fullName: "Old Guard",
          gameShape: "proficient",
          injuryWeeks: 0,
          nationalityName: "USA",
          playerId: "p1",
          ppg: 12.4,
          projectedStarterCount: 3,
          recentAvgMinutes: 31.2,
          recentStartCount: 5,
          salary: 50000,
        },
      ],
      syncedAt: "2026-04-10T00:00:00.000Z",
    },
  }) as any;

  const connection = {
    bbLoginName: "coach",
    lastSyncAt: "2026-04-10T00:00:00.000Z",
    status: "CONNECTED",
    teamId: "team-1",
    teamName: "Visionaries",
    userId: "user-1",
    workspaceCacheJson: existingCache,
  } as any;
  const repairedPlayer = {
    ...createOwnerTrackedPlayerProfile({
      block: 2,
      driving: 7,
      experience: 6,
      freeThrow: 7,
      gameShape: 10,
      handling: 8,
      insideDef: 3,
      insideShot: 4,
      jumpShot: 9,
      outsideDef: 5,
      passing: 9,
      potential: 10,
      range: 7,
      rebound: 4,
      stamina: 8,
    }),
    age: 27,
    dmi: 2000,
    fullName: "Fresh Snapshot",
    salary: 62000,
  };

  let updatedConnection: Record<string, unknown> | null = null;
  const trackedPlayers: unknown[] = [];
  const observations: unknown[] = [];
  const snapshots: unknown[] = [];

  const result = await repairOwnerRosterData(
    {
      env: {},
      identity: { sub: "user-1" },
    },
    {
      createClient: () => ({
        getRoster: async () => ({
          players: [repairedPlayer],
        }),
      }),
      getBbConnection: async () => connection,
      resolveAccessKey: async () => "secret",
      storeCanonicalPlayerSkillSnapshot: async (_env, record) => {
        snapshots.push(record);
      },
      upsertBbConnection: async (_env, record) => {
        updatedConnection = record as Record<string, unknown>;
      },
      upsertPlayerSkillObservation: async (_env, record) => {
        observations.push(record);
      },
      upsertTrackedPlayer: async (_env, record) => {
        trackedPlayers.push(record);
      },
    },
  );

  assert.equal(result.repairedPlayerCount, 1);
  assert.ok(result.completedAt);
  assert.equal(trackedPlayers.length, 1);
  assert.equal(observations.length, 1);
  assert.equal(snapshots.length, 1);
  assert.ok(updatedConnection);
  assert.equal(updatedConnection.lastSyncAt, "2026-04-10T00:00:00.000Z");
  assert.deepStrictEqual(updatedConnection.workspaceCacheJson?.home, existingCache.home);
  assert.deepStrictEqual(updatedConnection.workspaceCacheJson?.scout, existingCache.scout);
  assert.deepStrictEqual(
    updatedConnection.workspaceCacheJson?.leagueIntel,
    existingCache.leagueIntel,
  );
  assert.deepStrictEqual(
    updatedConnection.workspaceCacheJson?.playerLab,
    existingCache.playerLab,
  );
  assert.deepStrictEqual(
    updatedConnection.workspaceCacheJson?.arena,
    existingCache.arena,
  );
  assert.equal(
    updatedConnection.workspaceCacheJson?.teamHub?.roster?.[0]?.fullName,
    "Fresh Snapshot",
  );
  assert.equal(
    updatedConnection.workspaceCacheJson?.teamHub?.roster?.[0]?.projectedStarterCount,
    3,
  );
  assert.equal(
    updatedConnection.workspaceCacheJson?.teamHub?.roster?.[0]?.ppg,
    12.4,
  );
});

test("recent-context readers share the repair-aware cached-boxscore helper while bulk readers stay lightweight", () => {
  assert.match(workspaceSource, /getNormalizedCachedMatchBoxscore/);
  assert.match(lineupHelperSource, /getOrRepairRecentCachedMatchBoxscore/);
  assert.match(nextGameRecommendationSource, /getOrRepairRecentCachedMatchBoxscore/);
  assert.match(opponentForecastSource, /normalizeCachedMatchBoxscoreRecord/);
  assert.doesNotMatch(workspaceSource, /getOrRepairRecentCachedMatchBoxscore/);
  assert.doesNotMatch(opponentForecastSource, /getOrRepairRecentCachedMatchBoxscore/);
});

test("repairOwnerRosterData stays on the roster-only repair path instead of broad workspace sync", () => {
  const repairSection =
    workspaceSource.match(
      /export async function repairOwnerRosterData[\s\S]*?export async function getOrRefreshWorkspace/,
    )?.[0] ?? "";

  assert.match(repairSection, /client\.getRoster\(/);
  assert.doesNotMatch(repairSection, /getCurrentWorkspace\(/);
  assert.doesNotMatch(repairSection, /syncWorkspace\(/);
});

test("browse-time workspace refresh defaults to app-only persistence while explicit refresh paths sync owned active tracked teams", () => {
  assert.match(
    workspaceSource,
    /syncActiveTrackedTeams:\s*args\.syncActiveTrackedTeams \?\? false/,
  );
  assert.match(
    refreshWorkspaceHandlerSource,
    /syncActiveTrackedTeams:\s*true/,
  );
});

test("base workspace refresh keeps next-opponent scouting lightweight", () => {
  assert.match(
    workspaceSource,
    /const opponentWorkspace = nextOpponentTeamId\s*\?\s*await fetchHomeOpponentWorkspace\(/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /const opponentWorkspace = nextOpponentTeamId\s*\?\s*await fetchOpponentWorkspace\(/,
  );
  assert.doesNotMatch(
    homeWorkspaceHandlerSource,
    /getScoutScheduleForTeam|getScoutWorkspaceForTeam/,
  );
  assert.doesNotMatch(
    refreshWorkspaceHandlerSource,
    /getScoutScheduleForTeam|getScoutWorkspaceForTeam/,
  );
});

test("buildHomeWorkspace keeps next-opponent summary available when scout schedule is deferred", () => {
  const home = workspaceTesting.buildHomeWorkspace(
    {
      roster: { players: [] },
      schedule: { matches: [] },
      standings: {
        conferences: [
          {
            index: 0,
            teams: [
              {
                id: "OUR",
                losses: 6,
                pa: 91,
                pf: 97,
                teamName: "Our Team",
                wins: 10,
              },
              {
                id: "OPP",
                losses: 8,
                pa: 94,
                pf: 95,
                teamName: "Opp Team",
                wins: 8,
              },
            ],
          },
        ],
        league: { id: "L1", name: "League One" },
      },
      teamInfo: {
        teamId: "OUR",
        teamName: "Our Team",
      },
      teamStats: null,
    } as any,
    null,
    null,
    [],
    [],
    [],
    [],
    {
      competitionProfile: null,
      forecastSample: null,
      hydratedBoxScores: [],
      nextMatch: null,
      recentBoxScores: [
        {
          awayTeam: {
            defStrategy: "23Zone",
            id: "ALT",
            offStrategy: "Base",
            teamName: "Alt Team",
          },
          homeTeam: {
            defStrategy: "ManToMan",
            id: "OPP",
            offStrategy: "Push",
            teamName: "Opp Team",
          },
          matchId: "m-1",
        },
      ],
      recentMatches: [],
      roster: {
        players: [
          {
            fullName: "Injured Wing",
            id: "p-1",
            injuryWeeks: 2,
          },
        ],
      },
      schedule: null,
      teamInfo: {
        teamId: "OPP",
        teamName: "Opp Team",
      },
      teamStats: null,
    } as any,
    {
      lastSyncAt: "2026-04-11T00:00:00.000Z",
    } as any,
  );

  assert.ok(home.nextOpponent);
  assert.equal(home.nextScoutMatch, null);
  assert.equal(home.nextOpponent.teamName, "Opp Team");
  assert.deepStrictEqual(home.nextOpponent.record, { losses: 8, wins: 8 });
  assert.equal(home.nextOpponent.injuries[0]?.fullName, "Injured Wing");
  assert.deepStrictEqual(home.nextOpponent.tendencies.offense, [
    { count: 1, key: "Push" },
  ]);
  assert.equal("userId" in (home.connection as Record<string, unknown>), false);
  assert.equal(
    "shortName" in (home.connection as Record<string, unknown>),
    false,
  );
  assert.equal(
    "workspaceCacheJson" in (home.connection as Record<string, unknown>),
    false,
  );
});

test("workspace cache persistence projects the home connection into the cached connection shape", () => {
  const home = workspaceTesting.buildHomeWorkspace(
    {
      roster: { players: [] },
      schedule: { matches: [] },
      standings: {
        conferences: [],
        league: { id: "L1", name: "League One" },
      },
      teamInfo: {
        teamId: "OUR",
        teamName: "Our Team",
        shortName: "Our Short Name",
      },
      teamStats: null,
    } as any,
    null,
    null,
    [],
    [],
    [],
    [],
    null,
    {
      userId: "user-1",
      bbLoginName: "coach",
      status: "CONNECTED",
      teamId: "team-1",
      teamName: "Visionaries",
      shortName: "Visionaries",
      lastSyncAt: "2026-04-11T00:00:00.000Z",
      workspaceCacheJson: createWorkspaceCachePayload(),
    } as any,
  );
  const seededCache = createWorkspaceCachePayload();

  const payload = buildWorkspaceCachePayload({
    home,
    teamHub: seededCache.teamHub,
    scout: seededCache.scout,
    leagueIntel: seededCache.leagueIntel,
    playerLab: seededCache.playerLab,
    arena: seededCache.arena,
  });

  assert.equal(payload.home.connection.teamName, "Visionaries");
  assert.equal(
    "userId" in (payload.home.connection as Record<string, unknown>),
    false,
  );
  assert.equal(
    "shortName" in (payload.home.connection as Record<string, unknown>),
    false,
  );
  assert.equal(
    "workspaceCacheJson" in (payload.home.connection as Record<string, unknown>),
    false,
  );
});

test("buildHomeCorePlayers tolerates box score players without performance stats", () => {
  const topPlayers = workspaceTesting.buildHomeCorePlayers({
    rosterPlayers: [
      createOwnerTrackedPlayerProfile({
        block: 2,
        driving: 7,
        experience: 6,
        freeThrow: 7,
        gameShape: 8,
        handling: 8,
        insideDef: 3,
        insideShot: 4,
        jumpShot: 7,
        outsideDef: 5,
        passing: 9,
        potential: 10,
        range: 6,
        rebound: 4,
        stamina: 8,
      }),
    ],
    teamId: "team-1",
    teamStats: null,
    competitiveSample: {
      excludedGames: [],
      includedGames: [
        {
          boxScore: {
            awayTeam: {
              id: "opp-1",
              players: [],
            },
            homeTeam: {
              id: "team-1",
              players: [
                {
                  details: { isStarter: true },
                  fullName: "Lead Guard",
                  id: "p1",
                  minutesByPosition: { PG: 32 },
                },
              ],
            },
          },
          competition: {
            competitionKey: "LEAGUE_REGULAR_SEASON",
          },
          margin: 8,
          match: {
            awayTeam: { id: "opp-1", score: 82, teamName: "Opponent" },
            homeTeam: { id: "team-1", score: 90, teamName: "Alpha" },
            id: "m-1",
            startTime: "2026-04-11T20:00:00Z",
            type: "League",
          },
        },
      ],
      rawMatchesConsidered: 1,
    } as any,
  });

  const firstPlayer = topPlayers[0];
  assert.ok(firstPlayer);
  assert.equal(firstPlayer.playerId, "p1");
  assert.equal(firstPlayer.fullName, "Lead Guard");
});

test("workspace boxscore helpers tolerate missing starter details and minute positions", () => {
  const starterCounts = workspaceTesting.countStarters(
    [
      {
        awayTeam: {
          id: "opp-1",
          players: [],
        },
        homeTeam: {
          id: "team-1",
          players: [
            {
              fullName: "Lead Guard",
              id: "p1",
            },
          ],
        },
      },
    ] as any,
    "team-1",
  );

  assert.deepStrictEqual(starterCounts, {});

  const topPlayers = workspaceTesting.buildHomeCorePlayers({
    rosterPlayers: [
      createOwnerTrackedPlayerProfile({
        block: 2,
        driving: 7,
        experience: 6,
        freeThrow: 7,
        gameShape: 8,
        handling: 8,
        insideDef: 3,
        insideShot: 4,
        jumpShot: 7,
        outsideDef: 5,
        passing: 9,
        potential: 10,
        range: 6,
        rebound: 4,
        stamina: 8,
      }),
    ],
    teamId: "team-1",
    teamStats: null,
    competitiveSample: {
      excludedGames: [],
      includedGames: [
        {
          boxScore: {
            awayTeam: {
              id: "opp-1",
              players: [],
            },
            homeTeam: {
              id: "team-1",
              players: [
                {
                  fullName: "Lead Guard",
                  id: "p1",
                  performanceStats: {},
                },
              ],
            },
          },
          competition: {
            competitionKey: "LEAGUE_REGULAR_SEASON",
          },
          margin: 8,
          match: {
            awayTeam: { id: "opp-1", score: 82, teamName: "Opponent" },
            homeTeam: { id: "team-1", score: 90, teamName: "Alpha" },
            id: "m-1",
            startTime: "2026-04-11T20:00:00Z",
            type: "League",
          },
        },
      ],
      rawMatchesConsidered: 1,
    } as any,
  });

  assert.equal(topPlayers[0]?.playerId, "p1");
});

test("scout section handlers forward force flags and refresh home/core first when requested", () => {
  assert.match(
    workspaceSource,
    /const baseWorkspace = await getOrRefreshWorkspace\(\{\s*env: args\.env,\s*force: args\.force \?\? false,\s*identity: args\.identity,\s*syncActiveTrackedTeams: args\.force \?\? false,\s*\}\);/s,
  );
  assert.match(
    scoutTeamSummaryHandlerSource,
    /const force = event\.arguments\.force \?\? false;/,
  );
  assert.match(
    scoutScheduleHandlerSource,
    /const force = event\.arguments\.force \?\? false;/,
  );
});

test("scout team summary stays on the lightweight home-opponent path", () => {
  assert.match(
    scoutTeamSummarySection,
    /await fetchHomeOpponentWorkspace\(/,
  );
  assert.doesNotMatch(
    scoutTeamSummarySection,
    /await fetchOpponentWorkspace\(/,
  );
  assert.match(
    scoutTeamSummaryHandlerSource,
    /getScoutTeamSummary\.start/,
  );
  assert.match(
    scoutTeamSummaryHandlerSource,
    /getScoutTeamSummary\.completed/,
  );
  assert.match(
    scoutTeamSummaryHandlerSource,
    /getScoutTeamSummary\.failed/,
  );
});

test("scout schedule remains the only owner of heavy schedule hydration and timing logs", () => {
  assert.match(
    scoutScheduleSection,
    /await fetchOpponentSchedule\(/,
  );
  assert.match(
    workspaceSource,
    /getScoutSchedule\.base_workspace\.ready/,
  );
  assert.match(
    workspaceSource,
    /getScoutSchedule\.seasons\.ready/,
  );
  assert.match(
    workspaceSource,
    /getScoutSchedule\.season_schedules\.ready/,
  );
  assert.match(
    workspaceSource,
    /getScoutSchedule\.boxscore_hydration\.ready/,
  );
  assert.match(
    workspaceSource,
    /getScoutSchedule\.competition_profile\.ready/,
  );
  assert.match(
    scoutScheduleHandlerSource,
    /getScoutSchedule\.start/,
  );
  assert.match(
    scoutScheduleHandlerSource,
    /getScoutSchedule\.completed/,
  );
  assert.match(
    scoutScheduleHandlerSource,
    /getScoutSchedule\.failed/,
  );
});

test("home/core handlers emit request lifecycle logs without reintroducing scout schedule work", () => {
  assert.match(connectAccountHandlerSource, /connectBbAccount\.start/);
  assert.match(connectAccountHandlerSource, /connectBbAccount\.completed/);
  assert.match(connectAccountHandlerSource, /connectBbAccount\.failed/);
  assert.match(homeWorkspaceHandlerSource, /getHomeWorkspace\.start/);
  assert.match(homeWorkspaceHandlerSource, /getHomeWorkspace\.completed/);
  assert.match(homeWorkspaceHandlerSource, /getHomeWorkspace\.failed/);
  assert.match(refreshWorkspaceHandlerSource, /refreshWorkspace\.start/);
  assert.match(refreshWorkspaceHandlerSource, /refreshWorkspace\.completed/);
  assert.match(refreshWorkspaceHandlerSource, /refreshWorkspace\.failed/);
});

test("workspace request logging writes explicit console-based structured log lines", () => {
  assert.match(workspaceLoggingSource, /console\.log/);
  assert.match(workspaceLoggingSource, /console\.error/);
  assert.match(workspaceLoggingSource, /JSON\.stringify/);
  assert.match(workspaceLoggingSource, /\[workspace\]/);
});

test("refresh workspace keeps refresh-only persistence bounded and observable", () => {
  assert.match(
    syncWorkspaceSection,
    /const homeCoreBoxScores = await fetchRecentBoxScores\(client, homeCoreMatches\);/,
  );
  assert.doesNotMatch(
    syncWorkspaceSection,
    /const currentBoxScores = await fetchRecentBoxScores\(client, recentMatches\);/,
  );
  assert.match(
    workspaceSource,
    /syncWorkspace\.persist_workspace\.ready/,
  );
  assert.match(
    workspaceSource,
    /await mapWithConcurrency\(\s*workspace\.roster\.players,/s,
  );
  assert.match(
    workspaceSource,
    /await mapWithConcurrency\(\s*boxScoresToPersist,/s,
  );
});

test("workspace sync only performs rivals incremental upkeep after a completed backfill exists", () => {
  assert.match(workspaceSource, /getRivalsBackfill/);
  assert.match(syncWorkspaceSection, /rivalsStatus\?\.status === "SUCCEEDED"/);
  assert.match(syncWorkspaceSection, /syncRivalryMatchFactsFromSchedule/);
});

test("workspace sync keeps rivals incremental upkeep best-effort and observable", () => {
  assert.match(syncWorkspaceSection, /syncWorkspace\.rivalry_facts\.ready/);
  assert.match(syncWorkspaceSection, /syncWorkspace\.rivalry_facts\.failed/);
});

test("live-match workspace refresh falls back to cached data instead of flipping the connection into an error state", () => {
  assert.match(workspaceSource, /isMatchInProgressWorkspaceError/);
  assert.match(syncWorkspaceSection, /syncWorkspace\.match_in_progress_fallback/);
  assert.match(syncWorkspaceSection, /status:\s*"CONNECTED"/);
  assert.match(syncWorkspaceSection, /usedCachedWorkspace:\s*true/);
  assert.match(
    syncWorkspaceSection,
    /projectHomeWorkspaceConnection\(\s*connection,\s*cachedWorkspace\.home\.connection,/s,
  );
  assert.doesNotMatch(syncWorkspaceSection, /cachedWorkspace\.connection\./);
  assert.doesNotMatch(
    syncWorkspaceSection,
    /const fallbackConnection = buildConnectionRecord\([\s\S]*shortName:/s,
  );
  assert.doesNotMatch(
    syncWorkspaceSection,
    /const fallbackConnection = buildConnectionRecord\([\s\S]*workspaceCacheJson:/s,
  );
});

test("workspace cache-hit logs explain which cached workspace bundle was reused", () => {
  assert.match(syncWorkspaceSection, /syncWorkspace\.cache_hit/);
  assert.match(syncWorkspaceSection, /buildWorkspaceCacheMeta/);
  assert.match(workspaceSource, /cacheKind:\s*"workspace_bundle"/);
  assert.match(workspaceSource, /\bcachedAt\b/);
  assert.match(workspaceSource, /cacheAgeMs:/);
  assert.match(workspaceSource, /matchId:/);
  assert.match(workspaceSource, /opponentTeamName:/);
  assert.match(
    workspaceSource,
    /reason:\s*"force=false and cached workspace exists"/,
  );
});

test("scout loaders degrade to cached or partial data when a live match blocks current workspace reads", () => {
  assert.match(
    scoutTeamSummarySection,
    /getScoutTeamSummary\.match_in_progress_fallback/,
  );
  assert.match(
    scoutScheduleSection,
    /getScoutSchedule\.match_in_progress_fallback/,
  );
  assert.match(
    workspaceSource,
    /buildMatchInProgressScoutFallback/,
  );
  assert.match(
    workspaceSource,
    /home\.nextScoutMatch\?\.opponentTeamId/,
  );
});

test("scout default target prefers an explicit team id over the next-scout rollover target", () => {
  assert.equal(
    workspaceTesting.resolveScoutTeamId(
      {
        home: {
          nextScoutMatch: {
            opponentTeamId: "next-opp",
          },
        },
        scout: {
          teamId: "cached-opp",
        },
      } as any,
      "manual-opp",
    ),
    "manual-opp",
  );

  assert.equal(
    workspaceTesting.resolveScoutTeamId(
      {
        home: {
          nextScoutMatch: {
            opponentTeamId: "next-opp",
          },
        },
        scout: {
          teamId: "cached-opp",
        },
      } as any,
      "",
    ),
    "next-opp",
  );
});

test("live-match scout fallback references the next future opponent when the default target rolls forward", () => {
  const fallback = workspaceTesting.buildMatchInProgressScoutFallback(
    {
      home: {
        nextMatch: {
          opponentTeamId: "live-opp",
          opponentTeamName: "Live Opponent",
        },
        nextScoutMatch: {
          opponentTeamId: "next-opp",
          opponentTeamName: "Next Opponent",
        },
        syncedAt: "2026-04-11T20:00:00.000Z",
      },
      scout: {
        availableOpponents: [
          {
            teamId: "next-opp",
            teamName: "Next Opponent",
          },
        ],
        message: null,
        recentMatchups: [],
        requestedTeamId: null,
        schedule: null,
        summary: {
          teamName: "Next Opponent",
        },
        syncedAt: "2026-04-11T20:00:00.000Z",
        teamId: "next-opp",
      },
    } as any,
    "",
    "next-opp",
  );

  assert.match(
    fallback.message ?? "",
    /next scheduled opponent, Next Opponent/i,
  );
  assert.equal(fallback.teamId, "next-opp");
});

test("authenticated workspace hook only loads the active section's shared payloads", () => {
  assert.match(
    authenticatedWorkspaceHookSource,
    /const sectionDependencies:[\s\S]*highlights:\s*\[\][\s\S]*home:\s*\["lineupHelper"\][\s\S]*"opponent-schedule":\s*\[\][\s\S]*players:\s*\["playerLab"\][\s\S]*predictions:\s*\[\][\s\S]*scout:\s*\[\]/,
  );
  assert.doesNotMatch(
    authenticatedWorkspaceHookSource,
    /client\.queries\.getScoutWorkspace\(/,
  );
  assert.match(dashboardAppSource, /scoutTeamSummaryQueryOptions/);
  assert.match(dashboardAppSource, /scoutScheduleQueryOptions/);
  assert.match(
    dashboardAppSource,
    /useQueryStates\(\s*\n?\s*scoutUrlStateParsers\s*,?/s,
  );
});

test("connection state remains the only gate for the credential form", () => {
  assert.match(
    authenticatedWorkspaceHookSource,
    /if \(connectionQuery\.data\?\.status !== "CONNECTED"\) \{\s*setShowCredentialForm\(false\);/s,
  );
  assert.match(
    dashboardAppSource,
    /!connected \|\| showCredentialForm/,
  );
});

test("scout schedule failures stay local to Scout instead of replacing top-level workspace state", () => {
  assert.match(
    dashboardAppSource,
    /const scoutError = scoutSummaryError;/,
  );
  assert.match(
    dashboardAppSource,
    /const scoutScheduleStatusMessage = resolveScoutScheduleStatusMessage/,
  );
  assert.match(
    dashboardAppSource,
    /const scoutContextMessage = scout\?\.message \?\? scoutEventWindowMessage;/,
  );
  assert.match(
    dashboardAppSource,
    /scoutMessage:\s*scoutContextMessage \?\? null/,
  );
  assert.match(
    dashboardAppSource,
    /const nextScoutMatch = home\.nextScoutMatch \?\? null;/,
  );
});

test("getPlayerTrend preserves multiple observations captured in the same week", async () => {
  const trend = await getPlayerTrend(
    {
      env: {} as any,
      identity: { sub: "user-1" },
      playerId: "p1",
    },
    {
      getTrackedPlayer: async () =>
        ({
          playerId: "p1",
          fullName: "Prospect Player",
          bestPosition: "PG",
          salary: 120000,
        }) as any,
      listWorkspacePlayerHistory: async () => [
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-10T10:00:00.000Z",
          salary: 120000,
          dmi: 1500,
          gameShape: "proficient",
          injuryWeeks: 0,
        },
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-12T10:00:00.000Z",
          salary: 121000,
          dmi: 1800,
          gameShape: "strong",
          injuryWeeks: 0,
        },
        {
          weekKey: "2026-W12",
          capturedAt: "2026-03-19T10:00:00.000Z",
          salary: 122000,
          dmi: 2000,
          gameShape: "respectable",
          injuryWeeks: 1,
        },
      ],
    } as any,
  );

  assert.deepStrictEqual(
    trend.history.map((point) => point.fetchedAt),
    [
      "2026-03-10T10:00:00.000Z",
      "2026-03-12T10:00:00.000Z",
      "2026-03-19T10:00:00.000Z",
    ],
  );
  assert.deepStrictEqual(
    trend.history.map((point) => point.weekKey),
    ["2026-W11", "2026-W11", "2026-W12"],
  );
});

test("getPlayerTrend strips raw snapshot payload fields from the history response", async () => {
  const trend = await getPlayerTrend(
    {
      env: {} as any,
      identity: { sub: "user-1" },
      playerId: "p1",
    },
    {
      getTrackedPlayer: async () =>
        ({
          playerId: "p1",
          fullName: "Prospect Player",
          bestPosition: "PG",
          salary: 120000,
        }) as any,
      listWorkspacePlayerHistory: async () => [
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-10T10:00:00.000Z",
          salary: 120000,
          dmi: 1500,
          gameShape: "proficient",
          injuryWeeks: 0,
          payload: {
            profile: {
              skills: {
                jumpShot: 99,
              },
            },
          },
          profile: {
            hidden: true,
          },
          skills: {
            jumpShot: 99,
          },
        },
      ],
    } as any,
  );

  assert.deepStrictEqual(trend.history, [
    {
      weekKey: "2026-W11",
      fetchedAt: "2026-03-10T10:00:00.000Z",
      salary: 120000,
      dmi: 1500,
      injuryWeeks: 0,
      gameShape: "proficient",
    },
  ]);
  assert.equal("payload" in (trend.history[0] as Record<string, unknown>), false);
  assert.equal("profile" in (trend.history[0] as Record<string, unknown>), false);
  assert.equal("skills" in (trend.history[0] as Record<string, unknown>), false);
});

test("getPlayerTrend rejects player history requests outside the caller workspace", async () => {
  await assert.rejects(
    () =>
      getPlayerTrend(
        {
          env: {} as any,
          identity: { sub: "user-1" },
          playerId: "p1",
        },
        {
          getTrackedPlayer: async () =>
            ({
              playerId: "p1",
              fullName: "Prospect Player",
            }) as any,
          listWorkspacePlayerHistory: async () => {
            throw new Error(
              "The requested player is not available in the current workspace.",
            );
          },
        } as any,
      ),
    /The requested player is not available in the current workspace\./,
  );
});

test("buildSalaryProjectionPayload uses the latest snapshot from each week", () => {
  const payload = buildSalaryProjectionPayload({
    player: {
      playerId: "p1",
      fullName: "Prospect Player",
      salary: 121000,
      profileJson: null,
    } as any,
    snapshots: [
      {
        weekKey: "2026-W11",
        capturedAt: "2026-03-10T10:00:00.000Z",
        salary: 100000,
      },
      {
        weekKey: "2026-W11",
        capturedAt: "2026-03-12T10:00:00.000Z",
        salary: 100000,
      },
      {
        weekKey: "2026-W12",
        capturedAt: "2026-03-19T10:00:00.000Z",
        salary: 110000,
      },
      {
        weekKey: "2026-W13",
        capturedAt: "2026-03-26T10:00:00.000Z",
        salary: 121000,
      },
    ],
    teamCountryName: null,
  });

  assert.equal(payload.currentSalary, 121000);
  assert.equal(payload.weeklyDelta, 10500);
  assert.equal(payload.projectedSalary, 131500);
});

test("buildSalaryProjectionPayload ignores hidden snapshot payload content", () => {
  const payload = buildSalaryProjectionPayload({
    player: {
      playerId: "p1",
      fullName: "Prospect Player",
      salary: 121000,
      nationalityName: "USA",
      profileJson: {
        nationality: {
          name: "USA",
        },
        skills: {
          jumpShot: 99,
        },
      },
    } as any,
    snapshots: [
      {
        weekKey: "2026-W11",
        capturedAt: "2026-03-10T10:00:00.000Z",
        salary: 100000,
        payload: {
          profile: {
            skills: {
              jumpShot: 99,
            },
          },
        },
        skills: {
          jumpShot: 99,
        },
      },
      {
        weekKey: "2026-W12",
        capturedAt: "2026-03-17T10:00:00.000Z",
        salary: 121000,
      },
    ],
    teamCountryName: "USA",
  });

  assert.equal(payload.currentSalary, 121000);
  assert.equal(payload.nationalityName, "USA");
  assert.equal(payload.isFlagTarget, true);
  assert.equal("payload" in (payload as Record<string, unknown>), false);
  assert.equal("profile" in (payload as Record<string, unknown>), false);
  assert.equal("skills" in (payload as Record<string, unknown>), false);
});

test("lineup helper workspace payload includes defaults, evaluation, and snapshot warnings", async () => {
  const payload = await lineupHelperTesting.buildLineupHelperWorkspacePayload({
    generatedAt: "2026-03-15T00:00:00.000Z",
    syncedAt: "2026-03-15T00:00:00.000Z",
    defaultContext: {
      offense: "Base Offense",
      defense: "Man to man",
      enthusiasm: 5,
      homeCourt: "Away or Neutral",
      defensiveSwitch: {
        PG: "PG",
        SG: "SG",
        SF: "SF",
        PF: "PF",
        C: "C",
      },
    },
    roster: [
      createHelperPlayer("p1", "Lead Guard", "PG", {
        js: 12,
        jr: 11,
        od: 10,
        ha: 13,
        dr: 12,
        pa: 14,
        is: 5,
        id: 4,
        rb: 4,
        sb: 2,
        st: 8,
        ft: 7,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p2", "Shooter", "SG", {
        js: 13,
        jr: 12,
        od: 10,
        ha: 10,
        dr: 10,
        pa: 9,
        is: 6,
        id: 5,
        rb: 5,
        sb: 3,
        st: 8,
        ft: 8,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p3", "Wing", "SF", {
        js: 11,
        jr: 9,
        od: 10,
        ha: 9,
        dr: 10,
        pa: 8,
        is: 8,
        id: 8,
        rb: 8,
        sb: 5,
        st: 8,
        ft: 7,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p4", "Big", "PF", {
        js: 8,
        jr: 5,
        od: 7,
        ha: 6,
        dr: 7,
        pa: 6,
        is: 11,
        id: 10,
        rb: 11,
        sb: 8,
        st: 8,
        ft: 6,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p5", "Anchor", "C", {
        js: 6,
        jr: 2,
        od: 5,
        ha: 4,
        dr: 5,
        pa: 5,
        is: 12,
        id: 12,
        rb: 13,
        sb: 10,
        st: 8,
        ft: 5,
        ex: 6,
        gs: 11,
      }),
      {
        ...createHelperPlayer("p6", "Sixth Man", "SG", {
          js: 10,
          jr: 8,
          od: 9,
          ha: 8,
          dr: 8,
          pa: 9,
          is: 7,
          id: 7,
          rb: 6,
          sb: 4,
          st: 8,
          ft: 7,
          ex: 6,
          gs: 11,
        }),
      },
      {
        ...createHelperPlayer("p7", "Missing Snapshot", "SG", {}),
        available: false,
        snapshotWarning:
          "No canonical skill snapshot is available for this player.",
      },
    ] as any,
  });

  assert.equal(Array.isArray(payload.defaultAssignments), true);
  assert.equal(Array.isArray(payload.roster), true);
  assert.equal((payload.roster as Array<unknown>).length, 7);
  assert.equal(Array.isArray(payload.snapshotWarnings), true);
  assert.equal((payload.snapshotWarnings as Array<unknown>).length, 1);
  assert.equal(typeof payload.evaluation, "object");
  assert.equal((payload.defaultAssignments as Array<unknown>).length > 0, true);
  assert.deepStrictEqual(payload.defaultContext.defensiveSwitch, {
    pg: "PG",
    sg: "SG",
    sf: "SF",
    pf: "PF",
    c: "C",
  });
});

test("lineup helper workspace payload keeps the roster when no usable snapshots exist", async () => {
  const payload = await lineupHelperTesting.buildLineupHelperWorkspacePayload({
    generatedAt: "2026-03-15T00:00:00.000Z",
    syncedAt: "2026-03-15T00:00:00.000Z",
    defaultContext: {
      offense: "Base Offense",
      defense: "Man to man",
      enthusiasm: 5,
      homeCourt: "Away or Neutral",
      defensiveSwitch: {
        PG: "PG",
        SG: "SG",
        SF: "SF",
        PF: "PF",
        C: "C",
      },
    },
    roster: [
      {
        ...createHelperPlayer("p1", "Lead Guard", "PG", {}),
        available: false,
        snapshotWarning:
          "No canonical skill snapshot is available for this player.",
      },
      {
        ...createHelperPlayer("p2", "Shooter", "SG", {}),
        available: false,
        snapshotWarning:
          "No canonical skill snapshot is available for this player.",
      },
    ] as any,
  });

  assert.deepStrictEqual(payload.defaultAssignments, []);
  assert.equal(payload.evaluation, null);
  assert.equal(Array.isArray(payload.roster), true);
  assert.equal((payload.roster as Array<unknown>).length, 2);
  assert.equal(Array.isArray(payload.snapshotWarnings), true);
  assert.equal((payload.snapshotWarnings as Array<unknown>).length, 2);
});

test("lineup helper uses owner tracked profiles instead of shared snapshot payload skills", async () => {
  const workspace = await getLineupHelperWorkspace(
    {
      env: {} as any,
      identity: { sub: "user-1" },
    },
    {
      ...createLineupHelperDependencies({
        getBbConnection: async () => createLineupHelperConnection(),
      }),
      getOwnerTrackedPlayerProfile: async () =>
        createOwnerTrackedPlayerProfile({
          gameShape: 8,
          potential: 10,
          jumpShot: 7,
          range: 6,
          outsideDef: 5,
          handling: 8,
          driving: 7,
          passing: 9,
          insideShot: 4,
          insideDef: 3,
          rebound: 4,
          block: 2,
          stamina: 8,
          freeThrow: 7,
          experience: 6,
        }),
      listWorkspacePlayerHistory: async () => [
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-15T00:00:00.000Z",
          salary: 50000,
          bestPosition: "PG",
          gameShape: "respectable",
          dmi: 1500,
          injuryWeeks: 0,
          payload: {
            profile: {
              skills: {
                jumpShot: 99,
              },
            },
          },
          skills: {
            jumpShot: 99,
          },
        } as any,
      ],
    },
  );

  const rosterPlayer = workspace.roster[0] as Record<string, unknown>;
  const rosterSkills = rosterPlayer.skills as Record<string, unknown>;
  assert.equal(rosterPlayer.available, true);
  assert.equal(rosterSkills.js, 7);
  assert.equal(rosterSkills.jr, 6);
  assert.equal(rosterSkills.od, 5);
  assert.equal(rosterSkills.pa, 9);
  assert.equal(rosterSkills.rb, 4);
  assert.equal(rosterSkills.sb, 2);
  assert.equal(rosterSkills.gs, 8);
  assert.deepStrictEqual(workspace.snapshotWarnings, []);
});

test("lineup helper keeps players usable when owner skills exist but snapshot history is missing", async () => {
  const workspace = await getLineupHelperWorkspace(
    {
      env: {} as any,
      identity: { sub: "user-1" },
    },
    {
      ...createLineupHelperDependencies({
        getBbConnection: async () => createLineupHelperConnection(),
      }),
      getOwnerTrackedPlayerProfile: async () =>
        createOwnerTrackedPlayerProfile({
          gameShape: 8,
          potential: 10,
          jumpShot: 7,
          range: 6,
          outsideDef: 5,
          handling: 8,
          driving: 7,
          passing: 9,
          insideShot: 4,
          insideDef: 3,
          rebound: 4,
          block: 2,
          stamina: 8,
          freeThrow: 7,
          experience: 6,
        }),
      listWorkspacePlayerHistory: async () => [],
    },
  );

  const rosterPlayer = workspace.roster[0] as Record<string, unknown>;
  const rosterSkills = rosterPlayer.skills as Record<string, unknown>;
  assert.equal(rosterPlayer.available, true);
  assert.equal(rosterPlayer.snapshotWeekKey, null);
  assert.equal(rosterPlayer.snapshotCapturedAt, null);
  assert.equal(rosterSkills.js, 7);
  assert.equal(rosterSkills.pa, 9);
  assert.deepStrictEqual(workspace.snapshotWarnings, []);
});

test("lineup helper ignores shared snapshot payload bait when no owner profile exists", async () => {
  const workspace = await getLineupHelperWorkspace(
    {
      env: {} as any,
      identity: { sub: "user-1" },
    },
    {
      ...createLineupHelperDependencies({
        getBbConnection: async () => createLineupHelperConnection(),
      }),
      getOwnerTrackedPlayerProfile: async () => null,
      listWorkspacePlayerHistory: async () => [
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-15T00:00:00.000Z",
          salary: 50000,
          bestPosition: "PG",
          gameShape: "respectable",
          dmi: 1500,
          injuryWeeks: 0,
          payload: {
            profile: {
              skills: {
                jumpShot: 99,
              },
            },
          },
          skills: {
            jumpShot: 99,
          },
        } as any,
      ],
    },
  );

  const rosterPlayer = workspace.roster[0] as Record<string, unknown>;
  assert.equal(rosterPlayer.available, false);
  assert.deepStrictEqual(workspace.snapshotWarnings, [
    {
      playerId: "p1",
      fullName: "Lead Guard",
      warning: "No canonical skill snapshot is available for this player.",
    },
  ]);
});

test("lineup helper repairs an unreadable cached boxscore before falling through to later matches", async () => {
  const requestedMatchIds: string[] = [];
  const repairedMatchIds: string[] = [];
  const persistedMatchIds: string[] = [];
  const connection = createLineupHelperConnection();
  connection.workspaceCacheJson.home.recentMatches = [
    {
      effortDelta: null,
      hasBoxscore: true,
      matchId: "m-unreadable",
      opponentScore: null,
      opponentTeamName: "Unreadable",
      outcome: null,
      startTime: null,
      teamScore: null,
      type: null,
    },
    {
      effortDelta: null,
      hasBoxscore: true,
      matchId: "m-usable",
      opponentScore: null,
      opponentTeamName: "Usable",
      outcome: null,
      startTime: null,
      teamScore: null,
      type: null,
    },
  ];

  const workspace = await getLineupHelperWorkspace(
    {
      env: {} as any,
      identity: { sub: "user-1" },
    },
    {
      ...createLineupHelperDependencies({
        createBbClient: () => ({
          getBoxScore: async (matchId: string) => {
            repairedMatchIds.push(matchId);
            return {
              matchId,
              homeTeam: {
                id: "team-1",
                teamName: "Our Team",
                offStrategy: "Motion",
                defStrategy: "23Zone",
                players: [],
              },
              awayTeam: {
                id: "opp-1",
                teamName: "Opp Team",
                offStrategy: "Base",
                defStrategy: "ManToMan",
                players: [],
              },
            } as any;
          },
        }),
        getBbConnection: async () => connection,
        readMatchBoxscoreCacheRecord: async (_env, _userId, matchId) => {
          requestedMatchIds.push(matchId);
          if (matchId === "m-unreadable") {
            return {
              status: "unreadable",
              errorMessage: "legacy row",
            };
          }

          return {
            status: "hit",
            record: {
              matchId,
              boxscoreJson: {
                matchId,
                homeTeam: {
                  id: "team-1",
                  teamName: "Our Team",
                  offStrategy: "Base",
                  defStrategy: "ManToMan",
                  players: [],
                },
                awayTeam: {
                  id: "opp-1",
                  teamName: "Opp Team",
                  offStrategy: "Push",
                  defStrategy: "32Zone",
                  players: [],
                },
              },
            } as any,
          };
        },
        upsertMatchBoxscore: async (_env, record) => {
          persistedMatchIds.push(String(record.matchId));
        },
      }),
      getOwnerTrackedPlayerProfile: async () =>
        createOwnerTrackedPlayerProfile({
          gameShape: 8,
          potential: 10,
          jumpShot: 7,
          range: 6,
          outsideDef: 5,
          handling: 8,
          driving: 7,
          passing: 9,
          insideShot: 4,
          insideDef: 3,
          rebound: 4,
          block: 2,
          stamina: 8,
          freeThrow: 7,
          experience: 6,
        }),
      listWorkspacePlayerHistory: async () => [
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-15T00:00:00.000Z",
          salary: 50000,
          bestPosition: "PG",
          gameShape: "respectable",
          dmi: 1500,
          injuryWeeks: 0,
        } as any,
      ],
    },
  );

  assert.deepStrictEqual(requestedMatchIds, ["m-unreadable"]);
  assert.deepStrictEqual(repairedMatchIds, ["m-unreadable"]);
  assert.deepStrictEqual(persistedMatchIds, ["m-unreadable"]);
  assert.equal(workspace.defaultContext.offense, "Motion");
  assert.equal(workspace.defaultContext.defense, "2-3 Zone");
  assert.equal(workspace.defaultContext.homeCourt, "Home Court");
});

test("lineup helper evaluation payload rejects invalid minutes", () => {
  assert.throws(
    () =>
      lineupHelperTesting.buildLineupHelperEvaluationPayload({
        context: {
          offense: "Base Offense",
          defense: "Man to man",
          enthusiasm: 5,
          homeCourt: "Away or Neutral",
          defensiveSwitch: {
            PG: "PG",
            SG: "SG",
            SF: "SF",
            PF: "PF",
            C: "C",
          },
        },
        roster: [
          createHelperPlayer("p1", "Lead Guard", "PG", {
            js: 12,
            jr: 11,
            od: 10,
            ha: 13,
            dr: 12,
            pa: 14,
            is: 5,
            id: 4,
            rb: 4,
            sb: 2,
            st: 8,
            ft: 7,
            ex: 6,
            gs: 11,
          }),
          createHelperPlayer("p2", "Shooter", "SG", {
            js: 13,
            jr: 12,
            od: 10,
            ha: 10,
            dr: 10,
            pa: 9,
            is: 6,
            id: 5,
            rb: 5,
            sb: 3,
            st: 8,
            ft: 8,
            ex: 6,
            gs: 11,
          }),
          createHelperPlayer("p3", "Wing", "SF", {
            js: 11,
            jr: 9,
            od: 10,
            ha: 9,
            dr: 10,
            pa: 8,
            is: 8,
            id: 8,
            rb: 8,
            sb: 5,
            st: 8,
            ft: 7,
            ex: 6,
            gs: 11,
          }),
          createHelperPlayer("p4", "Big", "PF", {
            js: 8,
            jr: 5,
            od: 7,
            ha: 6,
            dr: 7,
            pa: 6,
            is: 11,
            id: 10,
            rb: 11,
            sb: 8,
            st: 8,
            ft: 6,
            ex: 6,
            gs: 11,
          }),
          createHelperPlayer("p5", "Anchor", "C", {
            js: 6,
            jr: 2,
            od: 5,
            ha: 4,
            dr: 5,
            pa: 5,
            is: 12,
            id: 12,
            rb: 13,
            sb: 10,
            st: 8,
            ft: 5,
            ex: 6,
            gs: 11,
          }),
          createHelperPlayer("p6", "Sixth Man", "SG", {
            js: 10,
            jr: 8,
            od: 9,
            ha: 8,
            dr: 8,
            pa: 9,
            is: 7,
            id: 7,
            rb: 6,
            sb: 4,
            st: 8,
            ft: 7,
            ex: 6,
            gs: 11,
          }),
        ] as any,
        assignments: [
          { playerId: "p1", position: "PG", minutes: 48 },
          { playerId: "p2", position: "SG", minutes: 42 },
          { playerId: "p6", position: "SG", minutes: 6 },
          { playerId: "p3", position: "SF", minutes: 42 },
          { playerId: "p6", position: "SF", minutes: 6 },
          { playerId: "p4", position: "PF", minutes: 42 },
          { playerId: "p6", position: "PF", minutes: 6 },
          { playerId: "p5", position: "C", minutes: 42 },
          { playerId: "p6", position: "C", minutes: 6 },
        ] as any,
      }),
    /Lead Guard exceeds 42 total minutes\./,
  );
});

test("optimizeLineupHelper returns a legal lineup and excludes unavailable players", async () => {
  const payload = await optimizeLineupHelper({
    roster: [
      createHelperPlayer("p1", "Lead Guard", "PG", {
        js: 12,
        jr: 11,
        od: 10,
        ha: 13,
        dr: 12,
        pa: 14,
        is: 5,
        id: 4,
        rb: 4,
        sb: 2,
        st: 8,
        ft: 7,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p2", "Shooter", "SG", {
        js: 13,
        jr: 12,
        od: 10,
        ha: 10,
        dr: 10,
        pa: 9,
        is: 6,
        id: 5,
        rb: 5,
        sb: 3,
        st: 8,
        ft: 8,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p3", "Wing", "SF", {
        js: 11,
        jr: 9,
        od: 10,
        ha: 9,
        dr: 10,
        pa: 8,
        is: 8,
        id: 8,
        rb: 8,
        sb: 5,
        st: 8,
        ft: 7,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p4", "Big", "PF", {
        js: 8,
        jr: 5,
        od: 7,
        ha: 6,
        dr: 7,
        pa: 6,
        is: 11,
        id: 10,
        rb: 11,
        sb: 8,
        st: 8,
        ft: 6,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p5", "Anchor", "C", {
        js: 6,
        jr: 2,
        od: 5,
        ha: 4,
        dr: 5,
        pa: 5,
        is: 12,
        id: 12,
        rb: 13,
        sb: 10,
        st: 8,
        ft: 5,
        ex: 6,
        gs: 11,
      }),
      createHelperPlayer("p6", "Sixth Man", "SG", {
        js: 10,
        jr: 8,
        od: 9,
        ha: 8,
        dr: 8,
        pa: 9,
        is: 7,
        id: 7,
        rb: 6,
        sb: 4,
        st: 8,
        ft: 7,
        ex: 6,
        gs: 11,
      }),
      {
        ...createHelperPlayer("p7", "Unavailable", "PF", {}),
        available: false,
        snapshotWarning: "No canonical skill snapshot is available for this player.",
      },
    ] as any,
    context: {
      offense: "Base Offense",
      defense: "Man to man",
      enthusiasm: 5,
      homeCourt: "Away or Neutral",
      defensiveSwitch: {
        PG: "PG",
        SG: "SG",
        SF: "SF",
        PF: "PF",
        C: "C",
      },
    },
  });

  assert.equal(Array.isArray(payload.normalizedLineup), true);
  assert.equal(payload.normalizedLineup.length > 0, true);
  assert.equal(
    payload.normalizedLineup.every((assignment) => assignment.playerId !== "p7"),
    true,
  );
  const positionMinutes = payload.normalizedLineup.reduce<Record<string, number>>(
    (totals, assignment) => {
      totals[assignment.position] = (totals[assignment.position] ?? 0) + assignment.minutes;
      return totals;
    },
    {},
  );
  assert.deepStrictEqual(positionMinutes, {
    PG: 48,
    SG: 48,
    SF: 48,
    PF: 48,
    C: 48,
  });
});

test("buildConnectionRecord preserves explicit null updates when clearing stale state", () => {
  const record = workspaceTesting.buildConnectionRecord(
    "user-1",
    {
      userId: "user-1",
      bbLoginName: "coach",
      status: "CONNECTED",
      accessKeyLast4: "****1234",
      teamId: "team-1",
      teamName: "Legacy Team",
      lastSyncError: "Old sync failure",
      workspaceCacheJson: {
        version: WORKSPACE_CACHE_VERSION,
        home: { stale: true },
      },
    } as any,
    {
      accessKeyLast4: null,
      lastSyncError: null,
      teamName: null,
      workspaceCacheJson: null,
    },
  );
  assert.deepStrictEqual(record, {
    userId: "user-1",
    bbLoginName: "coach",
    status: "CONNECTED",
    accessKeyLast4: null,
    teamId: "team-1",
    teamName: null,
    shortName: null,
    leagueId: null,
    leagueName: null,
    leagueTimeZone: null,
    countryId: null,
    countryName: null,
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
    lastSyncError: null,
    profileJson: null,
    workspaceCacheJson: null,
  });
});

test("lookupSharedPlayerCardByToken returns null for malformed stored payloads", async () => {
  const result = await lookupSharedPlayerCardByToken(
    {
      env: {},
      identity: { sub: "user-1" },
      shareToken: "share-token",
    },
    {
      getSharedPlayerCardRecord: async () => ({
        shareToken: "share-token",
        userId: "user-1",
        playerId: "player-1",
        title: "My player",
        note: "Fresh snapshot",
        expiresAt: "2099-03-15T00:00:00.000Z",
        revokedAt: null,
        payloadJson: {
          player: {
            userId: "user-1",
            playerId: "player-1",
            fullName: "Test Player",
            bestPosition: "SG",
            salary: 12345,
            nationalityName: "USA",
            gameShape: "strong",
            dmi: 456789,
            injuryWeeks: 0,
            profileJson: {
              hidden: true,
            },
          },
        },
      }),
      getTrackedPlayer: async () => null,
      listWorkspacePlayerHistory: async () => [],
      updateSharedPlayerCard: async () => undefined,
    },
  );

  assert.equal(result, null);
});

test("lookupSharedPlayerCardByToken returns null for revoked shares", async () => {
  const result = await lookupSharedPlayerCardByToken(
    {
      env: {},
      identity: { sub: "user-1" },
      shareToken: "share-token",
    },
    {
      getSharedPlayerCardRecord: async () => ({
        shareToken: "share-token",
        userId: "user-1",
        playerId: "player-1",
        title: "My player",
        note: "Fresh snapshot",
        expiresAt: "2099-03-15T00:00:00.000Z",
        revokedAt: "2026-03-15T00:00:00.000Z",
        payloadJson: {
          player: {
            fullName: "Test Player",
          },
        },
      }),
      getTrackedPlayer: async () => null,
      listWorkspacePlayerHistory: async () => [],
      updateSharedPlayerCard: async () => undefined,
    },
  );

  assert.equal(result, null);
});

function createHelperPlayer(
  playerId: string,
  fullName: string,
  bestPosition: string,
  skills: Record<string, number>,
) {
  return {
    playerId,
    fullName,
    bestPosition,
    salary: 50000,
    age: 26,
    gameShape: "strong",
    snapshotWeekKey: "2026-W11",
    snapshotCapturedAt: "2026-03-15T00:00:00.000Z",
    available: true,
    snapshotWarning: null,
    skills,
  };
}

function createLineupHelperConnection() {
  return {
    userId: "user-1",
    teamId: "team-1",
    bbLoginName: "coach-alpha",
    lastSyncAt: "2026-03-15T00:00:00.000Z",
    workspaceCacheJson: createWorkspaceCachePayload({
      teamHub: {
        roster: [
          {
            playerId: "p1",
            fullName: "Lead Guard",
            bestPosition: "PG",
            salary: 50000,
            age: 26,
            gameShape: "strong",
          },
        ],
      },
    }),
  } as any;
}

function createLineupHelperDependencies(overrides: Record<string, unknown> = {}) {
  return {
    createBbClient: () => ({
      getBoxScore: async () => {
        throw new Error("repair should not run in this test");
      },
    }),
    getBbConnection: async () => createLineupHelperConnection(),
    getOwnerTrackedPlayerProfile: async () => null,
    listWorkspacePlayerHistory: async () => [],
    readMatchBoxscoreCacheRecord: async () => ({
      status: "missing" as const,
    }),
    resolveBbAccessKey: async () => "secret",
    upsertMatchBoxscore: async () => undefined,
    ...overrides,
  };
}

function createOwnerTrackedPlayerProfile(
  skills: BBApiOwnedRosterPlayerSkills,
): BBApiOwnedRosterPlayer {
  return {
    id: "p1",
    firstName: "Lead",
    lastName: "Guard",
    fullName: "Lead Guard",
    salary: 50000,
    bestPosition: "PG",
    age: 26,
    height: 74,
    dmi: 1500,
    injuryWeeks: 0,
    nationality: {
      id: "1",
      name: "USA",
      attributes: {
        id: "1",
      },
    },
    skills,
  };
}

test("lookupSharedPlayerCardByToken returns null for expired shares", async () => {
  const result = await lookupSharedPlayerCardByToken(
    {
      env: {},
      identity: { sub: "user-1" },
      shareToken: "share-token",
    },
    {
      getSharedPlayerCardRecord: async () => ({
        shareToken: "share-token",
        userId: "user-1",
        playerId: "player-1",
        title: "My player",
        note: "Fresh snapshot",
        expiresAt: "2020-03-15T00:00:00.000Z",
        revokedAt: null,
        payloadJson: {
          player: {
            fullName: "Test Player",
          },
        },
      }),
      getTrackedPlayer: async () => null,
      listWorkspacePlayerHistory: async () => [],
      updateSharedPlayerCard: async () => undefined,
    },
  );

  assert.equal(result, null);
});

test("revokePlayerCard marks an owned share as revoked", async () => {
  let updatedInput: Record<string, unknown> | null = null;

  const result = await revokePlayerCard(
    {
      env: {},
      identity: { sub: "user-1" },
      shareToken: "share-token",
    },
    {
      getSharedPlayerCardRecord: async () => ({
        shareToken: "share-token",
        userId: "user-1",
        playerId: "player-1",
        title: "My player",
        note: "Fresh snapshot",
        expiresAt: "2099-03-15T00:00:00.000Z",
        revokedAt: null,
        payloadJson: {
          player: {
            playerId: "player-1",
            fullName: "Test Player",
          },
        },
      }),
      getTrackedPlayer: async () => null,
      listWorkspacePlayerHistory: async () => [],
      updateSharedPlayerCard: async (_env, input) => {
        updatedInput = input;
      },
    },
  );

  assert.deepStrictEqual(updatedInput, {
    shareToken: "share-token",
    revokedAt: result.revokedAt,
  });
  assert.equal(result.shareToken, "share-token");
  assert.equal(result.shareUrl, null);
  assert.equal(result.title, "My player");
  assert.match(result.revokedAt ?? "", /\d{4}-\d{2}-\d{2}T/);
});
