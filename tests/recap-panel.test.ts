import assert from "node:assert/strict";
import test from "node:test";

import {
  hasActiveGameDayRecap,
  resolveDefaultRecapDate,
  sortGameDayRecaps,
} from "../app/recap-panel";
import type { DashboardWorkspace, GameDayRecapRecord } from "../app/types";

function createWorkspace(): DashboardWorkspace {
  return {
    home: {
      connection: {
        bbLoginName: "coach-alpha",
        createdAt: "2026-03-15T20:00:00Z",
        leagueId: "100",
        leagueName: "Elite League",
        status: "CONNECTED",
        updatedAt: "2026-03-15T22:00:00Z",
        userId: "user-1",
      },
      league: {
        league: { id: "100", name: "Elite League" },
        standings: [],
      },
      nextMatch: null,
      nextOpponent: null,
      recentMatches: [
        {
          hasBoxscore: true,
          matchId: "m-1",
          opponentScore: 81,
          opponentTeamName: "Beta",
          outcome: "W",
          startTime: "2026-03-15T19:00:00Z",
          teamScore: 85,
          type: "League",
        },
      ],
      team: {
        injuries: [],
        record: { losses: 4, wins: 12 },
        shortName: "ALP",
        teamId: "A",
        teamName: "Alpha",
        topPlayers: [],
      },
    },
    leagueIntel: {
      league: { id: "100", name: "Elite League" },
      standings: [],
    },
    playerLab: {
      players: [],
    },
    scout: {
      availableOpponents: [],
      recentMatchups: [],
      summary: null,
      teamId: null,
    },
    syncedAt: "2026-03-15T22:00:00Z",
    teamHub: {
      roster: [],
      team: {},
    },
  };
}

function createRecapRecord(args: {
  requestedAt: string;
  status: GameDayRecapRecord["status"];
  targetKey: string;
  updatedAt?: string;
}): GameDayRecapRecord {
  return {
    createdAt: "2026-03-15T21:00:00Z",
    gameDate: "2026-03-15",
    leagueId: "100",
    leagueName: "Elite League",
    requestJson: {},
    requestedAt: args.requestedAt,
    status: args.status,
    targetKey: args.targetKey,
    updatedAt: args.updatedAt ?? args.requestedAt,
    userId: "user-1",
  };
}

test("resolveDefaultRecapDate uses the latest recent match date", () => {
  assert.equal(resolveDefaultRecapDate(createWorkspace()), "2026-03-15");
});

test("sortGameDayRecaps orders the most recent recap first", () => {
  const sorted = sortGameDayRecaps([
    createRecapRecord({
      requestedAt: "2026-03-15T22:00:00Z",
      status: "SUCCEEDED",
      targetKey: "older",
      updatedAt: "2026-03-15T22:01:00Z",
    }),
    createRecapRecord({
      requestedAt: "2026-03-15T23:00:00Z",
      status: "QUEUED",
      targetKey: "newer",
    }),
  ]);

  assert.equal(sorted[0]?.targetKey, "newer");
});

test("hasActiveGameDayRecap detects non-terminal recap work", () => {
  assert.equal(
    hasActiveGameDayRecap([
      createRecapRecord({
        requestedAt: "2026-03-15T22:00:00Z",
        status: "SUCCEEDED",
        targetKey: "done",
      }),
    ]),
    false,
  );

  assert.equal(
    hasActiveGameDayRecap([
      createRecapRecord({
        requestedAt: "2026-03-15T23:00:00Z",
        status: "BUILDING_CONTEXT",
        targetKey: "working",
      }),
    ]),
    true,
  );
});
