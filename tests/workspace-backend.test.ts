import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as workspaceTesting,
  buildScoutWorkspace,
  lookupSharedPlayerCardByToken,
  revokePlayerCard,
} from "../amplify/data/_backend/workspace";

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
            { id: "OUR", teamName: "Our Team", wins: 12, losses: 4, pf: 100, pa: 90 },
            { id: "OPP", teamName: "Opp Team", wins: 10, losses: 6, pf: 98, pa: 95 },
            { id: "ALT", teamName: "Alt Team", wins: 8, losses: 8, pf: 90, pa: 91 },
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
  assert.equal(scout.recentMatchups[0]?.matchId, "m1");
  assert.equal(scout.recentMatchups[0]?.hasBoxscore, true);
  assert.equal(scout.summary.record.wins, 10);
  assert.equal(scout.summary.recentGames[0]?.hasBoxscore, true);
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
      listWeeklyPlayerSnapshots: async () => [],
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
      listWeeklyPlayerSnapshots: async () => [],
      getMatchBoxscore: async () => null,
      updateSharedPlayerCard: async () => undefined,
    },
  );

  assert.equal(result, null);
});

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
      listWeeklyPlayerSnapshots: async () => [],
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
      listWeeklyPlayerSnapshots: async () => [],
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
