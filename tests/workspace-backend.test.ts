import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  __testing as lineupHelperTesting,
  getLineupHelperWorkspace,
} from "../amplify/data/_backend/lineup-helper";
import {
  __testing as workspaceTesting,
  buildSalaryProjectionPayload,
  buildScoutWorkspace,
  getPlayerTrend,
  lookupSharedPlayerCardByToken,
  revokePlayerCard,
} from "../amplify/data/_backend/workspace";

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
const refreshWorkerHandlerSource = readFileSync(
  join(repoRoot, "amplify", "data", "refresh-bb-workspace-worker", "handler.ts"),
  "utf8",
);

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
    workspaceCacheJson: {
      home: {},
      teamHub: {},
      scout: {},
      leagueIntel: {},
      playerLab: {},
    },
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

test("browse-time workspace refresh defaults to app-only persistence while explicit refresh paths sync owned active tracked teams", () => {
  assert.match(
    workspaceSource,
    /syncActiveTrackedTeams:\s*args\.syncActiveTrackedTeams \?\? false/,
  );
  assert.match(
    refreshWorkspaceHandlerSource,
    /syncActiveTrackedTeams:\s*true/,
  );
  assert.match(
    refreshWorkerHandlerSource,
    /syncActiveTrackedTeams:\s*true/,
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

test("lineup helper workspace payload includes defaults, evaluation, and snapshot warnings", () => {
  const payload = lineupHelperTesting.buildLineupHelperWorkspacePayload({
    generatedAt: "2026-03-15T00:00:00.000Z",
    syncedAt: "2026-03-15T00:00:00.000Z",
    defaultContext: {
      offense: "Base Offense",
      defense: "Man to man",
      enthusiasm: 5,
      homeCourt: "Away or Neutral",
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
        ...createHelperPlayer("p6", "Missing Snapshot", "SG", {}),
        available: false,
        snapshotWarning:
          "No canonical skill snapshot is available for this player.",
      },
    ] as any,
  });

  assert.equal(Array.isArray(payload.defaultAssignments), true);
  assert.equal(Array.isArray(payload.roster), true);
  assert.equal((payload.roster as Array<unknown>).length, 6);
  assert.equal(Array.isArray(payload.snapshotWarnings), true);
  assert.equal((payload.snapshotWarnings as Array<unknown>).length, 1);
  assert.equal(typeof payload.evaluation, "object");
});

test("lineup helper workspace payload keeps the roster when no usable snapshots exist", () => {
  const payload = lineupHelperTesting.buildLineupHelperWorkspacePayload({
    generatedAt: "2026-03-15T00:00:00.000Z",
    syncedAt: "2026-03-15T00:00:00.000Z",
    defaultContext: {
      offense: "Base Offense",
      defense: "Man to man",
      enthusiasm: 5,
      homeCourt: "Away or Neutral",
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
      getBbConnection: async () => createLineupHelperConnection(),
      getMatchBoxscore: async () => null,
      getOwnerTrackedPlayerProfile: async () =>
        createOwnerTrackedPlayerProfile({
          jumpShot: 7,
          jumpRange: 6,
          outsideDefense: 5,
          handling: 8,
          driving: 7,
          passing: 9,
          insideShot: 4,
          insideDefense: 3,
          rebounding: 4,
          shotBlocking: 2,
          stamina: 8,
          freeThrow: 7,
          experience: 6,
          gameShape: "strong",
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
  assert.equal(rosterSkills.pa, 9);
  assert.equal(rosterSkills.gs, 7);
  assert.deepStrictEqual(workspace.snapshotWarnings, []);
});

test("lineup helper ignores shared snapshot payload bait when no owner profile exists", async () => {
  const workspace = await getLineupHelperWorkspace(
    {
      env: {} as any,
      identity: { sub: "user-1" },
    },
    {
      getBbConnection: async () => createLineupHelperConnection(),
      getMatchBoxscore: async () => null,
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

test("lineup helper evaluation payload preserves warnings for invalid minutes", () => {
  const payload = lineupHelperTesting.buildLineupHelperEvaluationPayload({
    context: {
      offense: "Base Offense",
      defense: "Man to man",
      enthusiasm: 5,
      homeCourt: "Away or Neutral",
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
    ] as any,
    assignments: [
      { playerId: "p1", position: "PG", minutes: 60 },
      { playerId: "p2", position: "SG", minutes: 48 },
    ] as any,
  });

  assert.equal(Array.isArray(payload.warnings), true);
  assert.equal(payload.warnings.length > 0, true);
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

  const { refreshSortAt, ...rest } = record;

  assert.deepStrictEqual(rest, {
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
  assert.equal(typeof refreshSortAt, "string");
  assert.equal(Number.isNaN(Date.parse(refreshSortAt)), false);
});

test("lookupSharedPlayerCardByToken unwraps only the sanitized share payload", async () => {
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
      getMatchBoxscore: async () => null,
      updateSharedPlayerCard: async () => undefined,
    },
  );

  assert.deepStrictEqual(result, {
    shareToken: "share-token",
    shareUrl: null,
    title: "My player",
    note: "Fresh snapshot",
    expiresAt: "2099-03-15T00:00:00.000Z",
    revokedAt: null,
    payload: {
      player: {
        playerId: "player-1",
        fullName: "Test Player",
        bestPosition: "SG",
        salary: 12345,
        nationalityName: "USA",
        gameShape: "strong",
        dmi: 456789,
        injuryWeeks: 0,
      },
    },
  });
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
      getMatchBoxscore: async () => null,
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
    lastSyncAt: "2026-03-15T00:00:00.000Z",
    workspaceCacheJson: {
      connection: {},
      home: {
        recentMatches: [],
      },
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
      scout: {},
      leagueIntel: {},
      playerLab: {
        players: [],
      },
    },
  } as any;
}

function createOwnerTrackedPlayerProfile(skills: Record<string, unknown>) {
  return {
    age: 26,
    salary: 50000,
    skills,
  } as Record<string, unknown>;
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
      getMatchBoxscore: async () => null,
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
      getMatchBoxscore: async () => null,
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
