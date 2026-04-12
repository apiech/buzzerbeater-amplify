import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as recapTesting,
  hasActiveGameDayRecap,
  hasActiveRecapHistory,
  resolveDefaultRecapDate,
  sortGameDayRecaps,
} from "../app/recap-panel";
import type {
  GameDayRecapRecord,
  RecapHistoryRecord,
  RecapPanelContext,
} from "../app/types";

function createContext(): RecapPanelContext {
  return {
    connection: {
      countryId: "1",
      countryName: "USA",
      leagueId: "100",
      leagueName: "Elite League",
      leagueTimeZone: "America/New_York",
    },
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

function createRecapHistoryRecord(args: {
  kind?: RecapHistoryRecord["kind"];
  selectionKey: string;
  status: RecapHistoryRecord["status"];
  targetKey: string;
  updatedAt: string;
}): RecapHistoryRecord {
  return {
    completedAt: null,
    coverageJson: null,
    error: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: args.kind ?? "LEAGUE_DATE",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: {},
    requestedAt: args.updatedAt,
    resultJson: null,
    season: null,
    selectionKey: args.selectionKey,
    status: args.status,
    targetKey: args.targetKey,
    updatedAt: args.updatedAt,
  };
}

test("resolveDefaultRecapDate uses the latest recent match date", () => {
  assert.equal(resolveDefaultRecapDate(createContext()), "2026-03-15");
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

test("hasActiveRecapHistory detects non-terminal recap work", () => {
  assert.equal(
    hasActiveRecapHistory([
      createRecapHistoryRecord({
        selectionKey: "LEAGUE_DATE:done",
        status: "SUCCEEDED",
        targetKey: "done",
        updatedAt: "2026-03-15T22:00:00Z",
      }),
    ]),
    false,
  );

  assert.equal(
    hasActiveRecapHistory([
      createRecapHistoryRecord({
        kind: "SINGLE_GAME",
        selectionKey: "SINGLE_GAME:working",
        status: "QUEUED",
        targetKey: "working",
        updatedAt: "2026-03-15T23:00:00Z",
      }),
    ]),
    true,
  );
});

test("recap labels prefer headlines and league/date copy over raw ids", () => {
  const record = {
    completedAt: "2026-03-15T23:15:00Z",
    coverageJson: null,
    error: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: "SINGLE_GAME",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: "137828772",
    requestJson: {},
    requestedAt: "2026-03-15T23:00:00Z",
    resultJson: {
      games: [
        {
          evidenceTags: [],
          headline: "Alpha survives Beta late",
          matchId: "137828772",
          writeup: "Alpha finished the job.",
        },
      ],
      summary: {
        headline: "Alpha survives Beta late",
        lede: "A close finish swung late.",
      },
    },
    selectionKey: "SINGLE_GAME:137828772",
    season: null,
    status: "SUCCEEDED",
    targetKey: "137828772",
    updatedAt: "2026-03-15T23:10:00Z",
  } as const;

  assert.equal(recapTesting.recapTitle(record), "Alpha survives Beta late");
  assert.match(recapTesting.describeRecapRecord(record), /Elite League/);
  assert.match(recapTesting.describeRecapRecord(record), /2026-03-15/);
  assert.doesNotMatch(recapTesting.describeRecapRecord(record), /137828772/);
});

test("forum formatter builds BBCode with recap metadata and match links", () => {
  const record = {
    completedAt: "2026-03-15T23:15:00Z",
    coverageJson: null,
    error: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: "LEAGUE_DATE",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: {},
    requestedAt: "2026-03-15T23:00:00Z",
    resultJson: null,
    season: null,
    selectionKey: "LEAGUE_DATE:100#2026-03-15",
    status: "SUCCEEDED",
    targetKey: "100#2026-03-15",
    updatedAt: "2026-03-15T23:10:00Z",
  } as const;

  const forumPost = recapTesting.formatRecapForumPost(record, {
    games: [
      {
        evidenceTags: [],
        headline: "Alpha closes strong [late]",
        matchId: "137828772",
        surpriseFactor: 8.7,
        writeup: "Alpha handled Beta in the fourth quarter.",
      },
      {
        evidenceTags: [],
        headline: "Gamma keeps rolling",
        matchId: "scrim-like",
        surpriseFactor: 2.1,
        writeup: "Gamma's offense stayed sharp all night.",
      },
    ],
    summary: {
      gameOfTheDayMatchId: "137828772",
      gameOfTheDaySurpriseFactor: 8.7,
      headline: "Elite League roundup",
      lede: "Two games gave the forum plenty to discuss.",
    },
  });

  assert.match(forumPost, /^\[b]Elite League roundup\[\/b]/);
  assert.match(forumPost, /\[i]Elite League .+ 2026-03-15\[\/i]/);
  assert.match(
    forumPost,
    /\[quote]Two games gave the forum plenty to discuss\.\[\/quote]/,
  );
  assert.match(
    forumPost,
    /\[i]Game of the day: Alpha closes strong \(late\) • Surprise factor: 8\.7\/10\[\/i]/,
  );
  assert.match(forumPost, /\[b]Alpha closes strong \(late\)\[\/b]/);
  assert.match(
    forumPost,
    /\[i]Surprise factor: 8\.7\/10 • Game of the day\[\/i]/,
  );
  assert.match(forumPost, /\[i]Surprise factor: 2\.1\/10\[\/i]/);
  assert.match(forumPost, /Match: \[match=137828772]/);
  assert.match(forumPost, /Match: scrim-like/);
});
