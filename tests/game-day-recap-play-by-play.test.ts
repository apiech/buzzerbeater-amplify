import assert from "node:assert/strict";
import test from "node:test";

import {
  BBPublicPlayByPlayFetchError,
  BBPublicPlayByPlayParseError,
  fetchPublicMatchPlayByPlay,
} from "../lib/bbapi";
import {
  __testing,
  loadGameDayRecapPlayByPlayFacts,
} from "../amplify/data/_backend/game-day-recap-play-by-play";

function createEvent(args: {
  awayScore: number;
  clock?: string | null;
  eventText?: string | null;
  homeScore: number;
  id: number;
  isScoringPlay?: boolean;
  quarter: number;
  type?: string;
  wallClock: number;
}) {
  return {
    awayScore: args.awayScore,
    clock: args.clock ?? null,
    eventText: args.eventText ?? null,
    homeScore: args.homeScore,
    id: args.id,
    isScoringPlay: args.isScoringPlay ?? true,
    quarter: args.quarter,
    type:
      args.type ?? (args.isScoringPlay === false ? "QUARTER_HEADER" : "SHOT"),
    wallClock: args.wallClock,
  };
}

function createPlayByPlay(args: {
  events: ReturnType<typeof createEvent>[];
  matchId?: number;
}) {
  return {
    events: args.events,
    matchId: args.matchId ?? 129636791,
  };
}

function buildFacts(events: ReturnType<typeof createEvent>[]) {
  return __testing.buildGameDayRecapPlayByPlayFacts(
    createPlayByPlay({ events }),
    {
      awayTeamName: "Beta",
      homeTeamName: "Alpha",
    },
  );
}

test("fetchPublicMatchPlayByPlay parses the public payload shape and ignores extra fields", async () => {
  const payload = {
    events: [
      {
        awayScore: 0,
        homeScore: 0,
        id: -1,
        isHomePossession: false,
        isScoringPlay: false,
        quarter: 1,
        type: "QUARTER_HEADER",
        typeId: 0,
        wallClock: 0,
      },
      {
        awayScore: 0,
        clock: "11:57",
        eventText: "Jump ball won by D. Mathews.",
        homeScore: 0,
        id: 1,
        isHomePossession: false,
        isScoringPlay: false,
        keyPlayerId: 47837924,
        quarter: 1,
        type: "JUMP_BALL",
        typeId: 933,
        wallClock: 3,
      },
      {
        awayScore: 1,
        clock: "11:51",
        eventText: "The free throw by V. Sinsky is up and in.",
        homeScore: 0,
        id: 5,
        isHomePossession: false,
        isScoringPlay: true,
        keyPlayerId: 51211113,
        quarter: 1,
        type: "FREE_THROW_MADE",
        typeId: 502,
        wallClock: 25,
      },
    ],
    matchId: 129636791,
    venue: "Sample Arena",
  };

  const result = await fetchPublicMatchPlayByPlay(
    129636791,
    async () =>
      new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }),
  );

  assert.equal(result.matchId, 129636791);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[1]?.type, "JUMP_BALL");
  assert.equal(
    result.events[2]?.eventText,
    "The free throw by V. Sinsky is up and in.",
  );
});

test("loadGameDayRecapPlayByPlayFacts returns no facts when the public fetch fails", async () => {
  const result = await loadGameDayRecapPlayByPlayFacts({
    fetchPublicMatchPlayByPlay: async () => {
      throw new BBPublicPlayByPlayFetchError(
        "Public play-by-play request failed",
        "api/Matches/123/play-by-play?localeName=en",
        503,
      );
    },
    matchId: "123",
  });

  assert.equal(result.facts, null);
  assert.ok(result.error);
  assert.equal(result.error.kind, "fetch_failed");
  assert.equal(result.error.details.status, 503);
});

test("loadGameDayRecapPlayByPlayFacts returns no facts when the public payload cannot be parsed", async () => {
  const result = await loadGameDayRecapPlayByPlayFacts({
    fetchPublicMatchPlayByPlay: async () => {
      throw new BBPublicPlayByPlayParseError(
        "Public play-by-play response did not match the expected shape.",
        "api/Matches/123/play-by-play?localeName=en",
        '{"events":[]}',
      );
    },
    matchId: "123",
  });

  assert.equal(result.facts, null);
  assert.ok(result.error);
  assert.equal(result.error.kind, "parse_failed");
  assert.equal(result.error.details.bodyPreview, '{"events":[]}');
});

test("buildGameDayRecapPlayByPlayFacts captures a winning comeback and the biggest unanswered run", () => {
  const facts = buildFacts([
    createEvent({
      awayScore: 0,
      homeScore: 0,
      id: -1,
      isScoringPlay: false,
      quarter: 1,
      wallClock: 0,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:40",
      eventText: "Beta scores first.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 5,
      clock: "11:05",
      eventText: "Beta hits a three.",
      homeScore: 0,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 8,
      clock: "10:20",
      eventText: "Beta keeps rolling.",
      homeScore: 0,
      id: 3,
      quarter: 1,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 10,
      clock: "09:40",
      eventText: "Beta pushes the lead to double digits.",
      homeScore: 0,
      id: 4,
      quarter: 1,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 10,
      clock: "11:35",
      eventText: "Alpha starts the answer.",
      homeScore: 2,
      id: 5,
      quarter: 2,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 10,
      clock: "11:00",
      eventText: "Alpha knocks down a three.",
      homeScore: 5,
      id: 6,
      quarter: 2,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 10,
      clock: "10:20",
      eventText: "Alpha keeps trimming the margin.",
      homeScore: 7,
      id: 7,
      quarter: 2,
      wallClock: 35,
    }),
    createEvent({
      awayScore: 10,
      clock: "09:40",
      eventText: "Alpha ties it.",
      homeScore: 10,
      id: 8,
      quarter: 2,
      wallClock: 40,
    }),
    createEvent({
      awayScore: 10,
      clock: "09:00",
      eventText: "Alpha finishes the run.",
      homeScore: 14,
      id: 9,
      quarter: 2,
      wallClock: 45,
    }),
  ]);

  assert.equal(facts.leadChangeCount, 1);
  assert.equal(facts.winnerComebackDeficit, 10);
  assert.deepStrictEqual(facts.longestUnansweredRun, {
    points: 14,
    teamName: "Alpha",
    teamSide: "home",
  });
  assert.deepStrictEqual(facts.summaryLines, [
    "Alpha erased a 10-point deficit to win.",
    "Alpha authored the game's biggest unanswered burst with a 14-0 run.",
  ]);
});

test("buildGameDayRecapPlayByPlayFacts captures final-two-minute tie and go-ahead exchanges", () => {
  const facts = buildFacts([
    createEvent({
      awayScore: 0,
      homeScore: 0,
      id: -1,
      isScoringPlay: false,
      quarter: 1,
      wallClock: 0,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:40",
      eventText: "Beta opens the scoring.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:05",
      eventText: "Alpha ties it.",
      homeScore: 2,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 4,
      clock: "07:15",
      eventText: "Beta edges ahead again.",
      homeScore: 2,
      id: 3,
      quarter: 2,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 4,
      clock: "01:45",
      eventText: "Alpha draws level.",
      homeScore: 4,
      id: 4,
      quarter: 4,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 4,
      clock: "00:58",
      eventText: "Alpha goes in front.",
      homeScore: 6,
      id: 5,
      quarter: 4,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 6,
      clock: "00:30",
      eventText: "Beta answers to tie it.",
      homeScore: 6,
      id: 6,
      quarter: 4,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 6,
      clock: "00:12",
      eventText: "Alpha wins it late.",
      homeScore: 8,
      id: 7,
      quarter: 4,
      wallClock: 35,
    }),
  ]);

  assert.deepStrictEqual(facts.lateGameMoments, [
    {
      awayScore: 4,
      clock: "01:45",
      eventText: "Alpha draws level.",
      homeScore: 4,
      momentType: "tie",
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    {
      awayScore: 4,
      clock: "00:58",
      eventText: "Alpha goes in front.",
      homeScore: 6,
      momentType: "go_ahead",
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    {
      awayScore: 6,
      clock: "00:30",
      eventText: "Beta answers to tie it.",
      homeScore: 6,
      momentType: "tie",
      quarter: 4,
      scoringTeamName: "Beta",
      scoringTeamSide: "away",
    },
    {
      awayScore: 6,
      clock: "00:12",
      eventText: "Alpha wins it late.",
      homeScore: 8,
      momentType: "go_ahead",
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
  ]);
  assert.equal(
    facts.summaryLines.at(-1),
    "Late-game swings: Beta tied it at 6-6 with 00:30 left in the 4th quarter; Alpha went ahead 8-6 with 00:12 left in the 4th quarter.",
  );
});

test("buildGameDayRecapPlayByPlayFacts leaves late-game moments empty when nothing qualifies", () => {
  const facts = buildFacts([
    createEvent({
      awayScore: 0,
      homeScore: 0,
      id: -1,
      isScoringPlay: false,
      quarter: 1,
      wallClock: 0,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:40",
      eventText: "Beta starts well.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:10",
      eventText: "Alpha ties it.",
      homeScore: 2,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 2,
      clock: "02:01",
      eventText: "Alpha nudges in front too early for the clutch window.",
      homeScore: 4,
      id: 3,
      quarter: 4,
      wallClock: 15,
    }),
  ]);

  assert.deepStrictEqual(facts.lateGameMoments, []);
  assert.equal(
    facts.summaryLines.some((line) => line.startsWith("Late-game")),
    false,
  );
});

test("buildGameDayRecapPlayByPlayFacts treats overtime as a late-game period", () => {
  const facts = buildFacts([
    createEvent({
      awayScore: 0,
      homeScore: 0,
      id: -1,
      isScoringPlay: false,
      quarter: 1,
      wallClock: 0,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:40",
      eventText: "Beta scores first.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "00:10",
      eventText: "Alpha forces overtime.",
      homeScore: 2,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 2,
      clock: "00:42",
      eventText: "Alpha wins it in OT.",
      homeScore: 4,
      id: 3,
      quarter: 5,
      wallClock: 15,
    }),
  ]);

  assert.equal(facts.lateGameMoments.at(-1)?.quarter, 5);
  assert.equal(
    facts.summaryLines.at(-1),
    "Late-game swings: Alpha tied it at 2-2 with 00:10 left in the 4th quarter; Alpha went ahead 4-2 with 00:42 left in overtime.",
  );
});
