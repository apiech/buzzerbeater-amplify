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
  isHomePossession?: boolean;
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
    isHomePossession: args.isHomePossession ?? null,
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
    endAwayScore: 10,
    endClock: "09:00",
    endMarginFromTeamPerspective: 4,
    endedBy: "game_end",
    endHomeScore: 14,
    endQuarter: 2,
    marginSwing: 14,
    netMargin: 14,
    opponentPoints: 0,
    runType: "unanswered",
    startAwayScore: 10,
    startClock: "11:35",
    startMarginFromTeamPerspective: -10,
    startHomeScore: 0,
    startQuarter: 2,
    teamName: "Alpha",
    teamPoints: 14,
    teamSide: "home",
  });
  assert.deepStrictEqual(facts.bestCompetitiveSwingRun, {
    endAwayScore: 0,
    endClock: null,
    endMarginFromTeamPerspective: 0,
    endedBy: null,
    endHomeScore: 0,
    endQuarter: null,
    marginSwing: 0,
    netMargin: 0,
    opponentPoints: 0,
    runType: "swing",
    startAwayScore: 0,
    startClock: null,
    startMarginFromTeamPerspective: 0,
    startHomeScore: 0,
    startQuarter: null,
    teamName: null,
    teamPoints: 0,
    teamSide: null,
  });
  assert.ok(facts.summaryLines.includes("Alpha erased a 10-point deficit to win."));
  assert.ok(
    facts.summaryLines.includes(
      "Alpha erased a 10-point deficit and took the lead 14-10 with 09:00 left in the 2nd quarter.",
    ),
  );
  assert.ok(
    facts.summaryLines.some((line) =>
      /Alpha .*14-0 run from 11:35 left in the 2nd quarter to 09:00 left in the 2nd quarter/i.test(
        line,
      ),
    ),
  );
});

test("buildGameDayRecapPlayByPlayFacts captures a competitive answered swing run with timing anchors", () => {
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
      clock: "11:20",
      eventText: "Beta opens in front.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 4,
      clock: "10:50",
      eventText: "Beta keeps the edge.",
      homeScore: 2,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 4,
      clock: "08:00",
      eventText: "Alpha starts the push.",
      homeScore: 4,
      id: 3,
      quarter: 3,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 6,
      clock: "07:40",
      eventText: "Beta answers once.",
      homeScore: 4,
      id: 4,
      quarter: 3,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 6,
      clock: "07:10",
      eventText: "Alpha drills a three.",
      homeScore: 7,
      id: 5,
      quarter: 3,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 6,
      clock: "06:20",
      eventText: "Alpha adds two more.",
      homeScore: 9,
      id: 6,
      quarter: 3,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 7,
      clock: "05:55",
      eventText: "Beta splits a pair.",
      homeScore: 9,
      id: 7,
      quarter: 3,
      wallClock: 35,
    }),
    createEvent({
      awayScore: 7,
      clock: "05:25",
      eventText: "Alpha keeps coming.",
      homeScore: 11,
      id: 8,
      quarter: 3,
      wallClock: 40,
    }),
    createEvent({
      awayScore: 7,
      clock: "04:55",
      eventText: "Alpha hits another three.",
      homeScore: 14,
      id: 9,
      quarter: 3,
      wallClock: 45,
    }),
    createEvent({
      awayScore: 7,
      clock: "04:35",
      eventText: "Alpha caps the run.",
      homeScore: 16,
      id: 10,
      quarter: 3,
      wallClock: 50,
    }),
  ]);

  assert.deepStrictEqual(facts.bestCompetitiveSwingRun, {
    endAwayScore: 7,
    endClock: "04:35",
    endMarginFromTeamPerspective: 9,
    endedBy: "game_end",
    endHomeScore: 16,
    endQuarter: 3,
    marginSwing: 11,
    netMargin: 11,
    opponentPoints: 3,
    runType: "swing",
    startAwayScore: 4,
    startClock: "08:00",
    startMarginFromTeamPerspective: -2,
    startHomeScore: 2,
    startQuarter: 3,
    teamName: "Alpha",
    teamPoints: 14,
    teamSide: "home",
  });
  assert.ok(
    facts.summaryLines.some((line) =>
      /14-3 run from 08:00 left in the 3rd quarter to 04:35 left in the 3rd quarter/i.test(
        line,
      ),
    ),
  );
  assert.equal(facts.primaryRun?.teamSide, "home");
  assert.ok(facts.primaryRun);
  assert.equal(facts.primaryRun.teamPoints, 14);
  assert.equal(facts.primaryRun.opponentPoints, 3);
});

test("buildGameDayRecapPlayByPlayFacts ignores swing runs that started after the game was no longer competitive", () => {
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
      awayScore: 14,
      clock: "09:10",
      eventText: "Beta has already opened a big lead.",
      homeScore: 4,
      id: 1,
      quarter: 2,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 14,
      clock: "08:30",
      eventText: "Alpha finally starts scoring.",
      homeScore: 6,
      id: 2,
      quarter: 2,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 16,
      clock: "08:10",
      eventText: "Beta answers.",
      homeScore: 6,
      id: 3,
      quarter: 2,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 16,
      clock: "07:40",
      eventText: "Alpha hits a three.",
      homeScore: 9,
      id: 4,
      quarter: 2,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 16,
      clock: "06:50",
      eventText: "Alpha adds two more.",
      homeScore: 11,
      id: 5,
      quarter: 2,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 17,
      clock: "06:20",
      eventText: "Beta gets one back.",
      homeScore: 11,
      id: 6,
      quarter: 2,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 17,
      clock: "05:45",
      eventText: "Alpha keeps scoring.",
      homeScore: 13,
      id: 7,
      quarter: 2,
      wallClock: 35,
    }),
    createEvent({
      awayScore: 17,
      clock: "05:05",
      eventText: "Alpha hits a three again.",
      homeScore: 16,
      id: 8,
      quarter: 2,
      wallClock: 40,
    }),
    createEvent({
      awayScore: 17,
      clock: "04:40",
      eventText: "Alpha trims it further.",
      homeScore: 18,
      id: 9,
      quarter: 2,
      wallClock: 45,
    }),
  ]);

  assert.equal(facts.bestCompetitiveSwingRun.teamSide, null);
  assert.ok(
    facts.summaryLines.some((line) => /\brun\b/i.test(line)),
  );
});

test("buildGameDayRecapPlayByPlayFacts does not surface a low-differential 10-8 answered span as primaryRun", () => {
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
      awayScore: 0,
      clock: "11:40",
      eventText: "Alpha opens the scoring.",
      homeScore: 2,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "11:10",
      eventText: "Beta answers right back.",
      homeScore: 2,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 2,
      clock: "10:40",
      eventText: "Alpha hits a three.",
      homeScore: 5,
      id: 3,
      quarter: 1,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 5,
      clock: "10:10",
      eventText: "Beta answers with a three.",
      homeScore: 5,
      id: 4,
      quarter: 1,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 5,
      clock: "09:40",
      eventText: "Alpha scores again.",
      homeScore: 7,
      id: 5,
      quarter: 1,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 7,
      clock: "09:10",
      eventText: "Beta keeps pace.",
      homeScore: 7,
      id: 6,
      quarter: 1,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 7,
      clock: "08:40",
      eventText: "Alpha adds three more.",
      homeScore: 10,
      id: 7,
      quarter: 1,
      wallClock: 35,
    }),
    createEvent({
      awayScore: 8,
      clock: "08:10",
      eventText: "Beta sneaks in one from the line.",
      homeScore: 10,
      id: 8,
      quarter: 1,
      wallClock: 40,
    }),
  ]);

  assert.equal(facts.primaryRun, null);
  assert.equal(facts.secondaryRun, null);
});

test("buildGameDayRecapPlayByPlayFacts does not surface an answered span that only qualifies beyond the run cap", () => {
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
      awayScore: 0,
      clock: "11:50",
      eventText: "Alpha scores first.",
      homeScore: 2,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "10:50",
      eventText: "Beta answers.",
      homeScore: 2,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 2,
      clock: "09:50",
      eventText: "Alpha hits a jumper.",
      homeScore: 4,
      id: 3,
      quarter: 1,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 3,
      clock: "08:50",
      eventText: "Beta trims one point.",
      homeScore: 4,
      id: 4,
      quarter: 1,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 3,
      clock: "07:50",
      eventText: "Alpha keeps scoring.",
      homeScore: 6,
      id: 5,
      quarter: 1,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 4,
      clock: "06:50",
      eventText: "Beta answers again.",
      homeScore: 6,
      id: 6,
      quarter: 1,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 4,
      clock: "05:50",
      eventText: "Alpha keeps building.",
      homeScore: 8,
      id: 7,
      quarter: 1,
      wallClock: 35,
    }),
    createEvent({
      awayScore: 4,
      clock: "04:50",
      eventText: "Alpha scores again, but only after the capped window.",
      homeScore: 10,
      id: 8,
      quarter: 1,
      wallClock: 40,
    }),
  ]);

  assert.equal(facts.primaryRun, null);
  assert.equal(facts.secondaryRun, null);
});

test("buildGameDayRecapPlayByPlayFacts captures a comeback lead change after erasing an 8-point deficit", () => {
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
      awayScore: 12,
      clock: "09:15",
      eventText: "Beta builds a 12-point lead.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 12,
      clock: "02:00",
      eventText: "Alpha completes the comeback to tie it.",
      homeScore: 12,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 12,
      clock: "01:30",
      eventText: "Alpha takes the lead.",
      homeScore: 14,
      id: 3,
      quarter: 4,
      wallClock: 15,
    }),
  ]);

  assert.deepStrictEqual(facts.leadChangeFacts.bigComebackLeadChange, {
    awayScore: 12,
    clock: "01:30",
    deficitErased: 12,
    eventText: "Alpha takes the lead.",
    homeScore: 14,
    previousLeaderSide: "away",
    quarter: 4,
    scoringTeamName: "Alpha",
    scoringTeamSide: "home",
  });
  assert.equal(
    facts.summaryLines[1],
    "Alpha erased a 12-point deficit and took the lead 14-12 with 01:30 left in the 4th quarter.",
  );
});

test("buildGameDayRecapPlayByPlayFacts captures a rapid burst of lead changes", () => {
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
      clock: "02:10",
      eventText: "Beta leads entering the chaos.",
      homeScore: 0,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "01:50",
      eventText: "Alpha edges ahead.",
      homeScore: 3,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 4,
      clock: "01:30",
      eventText: "Beta answers immediately.",
      homeScore: 3,
      id: 3,
      quarter: 4,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 4,
      clock: "01:10",
      eventText: "Alpha flips it back.",
      homeScore: 5,
      id: 4,
      quarter: 4,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 6,
      clock: "00:55",
      eventText: "Beta snatches the lead again.",
      homeScore: 5,
      id: 5,
      quarter: 4,
      wallClock: 25,
    }),
  ]);

  assert.deepStrictEqual(facts.leadChangeFacts.rapidLeadChangeBurst, {
    endClock: "00:55",
    endQuarter: 4,
    leadChangeCount: 4,
    startClock: "01:50",
    startQuarter: 4,
  });
  assert.ok(
    facts.summaryLines.includes(
      "The lead changed hands 4 times from 01:50 left in the 4th quarter to 00:55 left in the 4th quarter.",
    ),
  );
});

test("buildGameDayRecapPlayByPlayFacts flags high-volume lead-change games even without a rapid burst", () => {
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
      clock: "11:30",
      eventText: "Beta scores first.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "08:30",
      eventText: "Alpha goes in front.",
      homeScore: 3,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 4,
      clock: "05:30",
      eventText: "Beta retakes the lead.",
      homeScore: 3,
      id: 3,
      quarter: 1,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 4,
      clock: "02:30",
      eventText: "Alpha answers.",
      homeScore: 6,
      id: 4,
      quarter: 1,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 7,
      clock: "11:30",
      eventText: "Beta edges back in front.",
      homeScore: 6,
      id: 5,
      quarter: 2,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 7,
      clock: "08:30",
      eventText: "Alpha flips it again.",
      homeScore: 9,
      id: 6,
      quarter: 2,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 10,
      clock: "05:30",
      eventText: "Beta retakes control.",
      homeScore: 9,
      id: 7,
      quarter: 2,
      wallClock: 35,
    }),
    createEvent({
      awayScore: 10,
      clock: "11:30",
      eventText: "Alpha moves back ahead.",
      homeScore: 12,
      id: 8,
      quarter: 3,
      wallClock: 40,
    }),
    createEvent({
      awayScore: 13,
      clock: "08:30",
      eventText: "Beta answers again.",
      homeScore: 12,
      id: 9,
      quarter: 3,
      wallClock: 45,
    }),
    createEvent({
      awayScore: 13,
      clock: "11:30",
      eventText: "Alpha goes back on top.",
      homeScore: 15,
      id: 10,
      quarter: 4,
      wallClock: 50,
    }),
    createEvent({
      awayScore: 16,
      clock: "08:30",
      eventText: "Beta gets the last flip.",
      homeScore: 15,
      id: 11,
      quarter: 4,
      wallClock: 55,
    }),
  ]);

  assert.equal(facts.leadChangeCount, 10);
  assert.deepStrictEqual(facts.leadChangeFacts.highVolumeLeadChangeGame, {
    leadChangeCount: 10,
    qualifies: true,
  });
  assert.equal(facts.leadChangeFacts.rapidLeadChangeBurst, null);
  assert.ok(
    facts.summaryLines.includes("The game featured 10 lead changes."),
  );
});

test("buildGameDayRecapPlayByPlayFacts keeps run timing intact when a run spans quarters", () => {
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
      awayScore: 20,
      clock: "00:45",
      eventText: "Alpha is already in striking distance.",
      homeScore: 14,
      id: 1,
      isScoringPlay: false,
      quarter: 2,
      type: "DEAD_BALL",
      wallClock: 5,
    }),
    createEvent({
      awayScore: 20,
      clock: "00:30",
      eventText: "Alpha starts a late push.",
      homeScore: 16,
      id: 2,
      quarter: 2,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 20,
      clock: "11:45",
      eventText: "Alpha keeps it going after the break.",
      homeScore: 19,
      id: 3,
      quarter: 3,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 20,
      clock: "11:10",
      eventText: "Alpha caps the run.",
      homeScore: 22,
      id: 4,
      quarter: 3,
      wallClock: 20,
    }),
  ]);

  assert.deepStrictEqual(facts.longestUnansweredRun, {
    endAwayScore: 20,
    endClock: "11:10",
    endMarginFromTeamPerspective: 2,
    endedBy: "game_end",
    endHomeScore: 22,
    endQuarter: 3,
    marginSwing: 8,
    netMargin: 8,
    opponentPoints: 0,
    runType: "unanswered",
    startAwayScore: 20,
    startClock: "00:30",
    startMarginFromTeamPerspective: -6,
    startHomeScore: 14,
    startQuarter: 2,
    teamName: "Alpha",
    teamPoints: 8,
    teamSide: "home",
  });
  assert.ok(
    facts.summaryLines.some((line) =>
      /8-0 run from 00:30 left in the 2nd quarter to 11:10 left in the 3rd quarter/i.test(
        line,
      ),
    ),
  );
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
  assert.deepStrictEqual(facts.endingFacts, {
    decisiveScore: {
      awayScore: 6,
      clock: "00:12",
      createdWinningMargin: true,
      eventText: "Alpha wins it late.",
      explicitBuzzerBeater: false,
      homeScore: 8,
      isBuzzerBeater: false,
      isWalkOff: false,
      momentType: "go_ahead",
      points: 2,
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    opponentLastChance: null,
  });
  assert.ok(
    facts.summaryLines.includes(
      "Late-game swings: Beta tied it at 6-6 with 00:30 left in the 4th quarter; Alpha went ahead 8-6 with 00:12 left in the 4th quarter.",
    ),
  );
});

test("buildGameDayRecapPlayByPlayFacts marks a go-ahead basket at 00:00 as a buzzerbeater", () => {
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
      awayScore: 99,
      clock: "00:05",
      eventText: "Beta takes the late lead.",
      homeScore: 98,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 99,
      clock: "00:00",
      eventText: "Alpha buries the winner.",
      homeScore: 101,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
  ]);

  assert.deepStrictEqual(facts.endingFacts, {
    decisiveScore: {
      awayScore: 99,
      clock: "00:00",
      createdWinningMargin: true,
      eventText: "Alpha buries the winner.",
      explicitBuzzerBeater: false,
      homeScore: 101,
      isBuzzerBeater: true,
      isWalkOff: true,
      momentType: "go_ahead",
      points: 3,
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    opponentLastChance: null,
  });
  assert.ok(
    facts.summaryLines.includes(
      "Alpha won it on a buzzerbeater, going ahead 101-99 at the buzzer in the 4th quarter.",
    ),
  );
});

test("buildGameDayRecapPlayByPlayFacts treats explicit buzzerbeater commentary as supporting evidence", () => {
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
      awayScore: 99,
      clock: "00:04",
      eventText: "Beta grabs the lead.",
      homeScore: 98,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 99,
      clock: "00:00",
      eventText: "Alpha wins it at the horn.",
      homeScore: 101,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 99,
      clock: "00:00",
      eventText: "A buzzerbeater for Alpha!",
      homeScore: 101,
      id: 3,
      isHomePossession: true,
      isScoringPlay: false,
      quarter: 4,
      type: "COMMENTARY",
      wallClock: 11,
    }),
  ]);

  const decisiveScore = facts.endingFacts.decisiveScore;
  assert.ok(decisiveScore);
  assert.equal(decisiveScore.isBuzzerBeater, true);
  assert.equal(decisiveScore.explicitBuzzerBeater, true);
});

test("buildGameDayRecapPlayByPlayFacts falls back to the earlier go-ahead when a later insurance basket was not decisive", () => {
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
      clock: "01:10",
      eventText: "Beta moves in front.",
      homeScore: 0,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 2,
      clock: "01:02",
      eventText: "Alpha ties it.",
      homeScore: 2,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 2,
      clock: "00:58",
      eventText: "Alpha takes the lead.",
      homeScore: 4,
      id: 3,
      quarter: 4,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 2,
      clock: "00:15",
      eventText: "Alpha adds the late insurance basket.",
      homeScore: 6,
      id: 4,
      quarter: 4,
      wallClock: 20,
    }),
  ]);

  assert.equal(facts.endingFacts.decisiveScore?.eventText, "Alpha takes the lead.");
  assert.ok(facts.endingFacts.decisiveScore);
  assert.equal(facts.endingFacts.decisiveScore.momentType, "go_ahead");
});

test("buildGameDayRecapPlayByPlayFacts does not treat a 2nd-quarter permanent go-ahead as a decisive ending", () => {
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
      awayScore: 4,
      clock: "10:50",
      eventText: "Beta opens in front.",
      homeScore: 0,
      id: 1,
      quarter: 1,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 8,
      clock: "08:40",
      eventText: "Beta extends the edge.",
      homeScore: 2,
      id: 2,
      quarter: 1,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 10,
      clock: "11:15",
      eventText: "Beta scores first in the 2nd.",
      homeScore: 6,
      id: 3,
      quarter: 2,
      wallClock: 15,
    }),
    createEvent({
      awayScore: 10,
      clock: "10:40",
      eventText: "Alpha starts climbing back.",
      homeScore: 8,
      id: 4,
      quarter: 2,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 10,
      clock: "09:55",
      eventText: "Alpha ties it.",
      homeScore: 10,
      id: 5,
      quarter: 2,
      wallClock: 25,
    }),
    createEvent({
      awayScore: 10,
      clock: "09:10",
      eventText: "Alpha takes the lead for good in the 2nd.",
      homeScore: 12,
      id: 6,
      quarter: 2,
      wallClock: 30,
    }),
    createEvent({
      awayScore: 24,
      clock: "04:30",
      eventText: "Alpha has stretched the game open.",
      homeScore: 38,
      id: 7,
      quarter: 4,
      wallClock: 35,
    }),
  ]);

  assert.equal(facts.endingFacts.decisiveScore, null);
  assert.equal(facts.endingFacts.opponentLastChance, null);
});

test("buildGameDayRecapPlayByPlayFacts ignores a 2nd-quarter go-ahead plus a mid-game last chance when resolving decisive endings", () => {
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
      awayScore: 14,
      clock: "04:40",
      eventText: "Beta keeps the early edge.",
      homeScore: 12,
      id: 1,
      quarter: 2,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 16,
      clock: "04:15",
      eventText: "W. Orourke's free throw attempt is up and good.",
      homeScore: 17,
      id: 2,
      quarter: 2,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 16,
      clock: "03:29",
      eventText: "Beta misses the go-ahead jumper from the wing.",
      homeScore: 17,
      id: 3,
      isHomePossession: false,
      isScoringPlay: false,
      quarter: 2,
      type: "MISS",
      wallClock: 12,
    }),
    createEvent({
      awayScore: 39,
      clock: "00:00",
      eventText: "Alpha takes a six-point edge to the 4th.",
      homeScore: 45,
      id: 4,
      quarter: 3,
      wallClock: 20,
    }),
    createEvent({
      awayScore: 55,
      clock: "00:00",
      eventText: "Alpha closes the opener out.",
      homeScore: 69,
      id: 5,
      quarter: 4,
      wallClock: 30,
    }),
  ]);

  assert.equal(facts.endingFacts.decisiveScore, null);
  assert.equal(facts.endingFacts.opponentLastChance, null);
});

test("buildGameDayRecapPlayByPlayFacts does not treat a safe late lead-extension basket as decisive without one-possession pressure", () => {
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
      awayScore: 71,
      clock: "00:48",
      eventText: "Alpha already leads comfortably.",
      homeScore: 79,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 71,
      clock: "00:15",
      eventText: "Alpha adds one more basket with the game already in hand.",
      homeScore: 81,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
  ]);

  assert.equal(facts.endingFacts.decisiveScore, null);
  assert.equal(facts.endingFacts.opponentLastChance, null);
});

test("buildGameDayRecapPlayByPlayFacts captures a missed tying shot at the horn", () => {
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
      awayScore: 76,
      clock: "00:16",
      eventText: "Alpha ties it up.",
      homeScore: 76,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 76,
      clock: "00:08",
      eventText: "Alpha answers for the lead.",
      homeScore: 78,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 76,
      clock: "00:00",
      eventText: "Beta misses the tying jumper at the horn.",
      homeScore: 78,
      id: 3,
      isHomePossession: false,
      isScoringPlay: false,
      quarter: 4,
      type: "MISS",
      wallClock: 12,
    }),
  ]);

  assert.deepStrictEqual(facts.endingFacts, {
    decisiveScore: {
      awayScore: 76,
      clock: "00:08",
      createdWinningMargin: true,
      eventText: "Alpha answers for the lead.",
      explicitBuzzerBeater: false,
      homeScore: 78,
      isBuzzerBeater: false,
      isWalkOff: false,
      momentType: "go_ahead",
      points: 2,
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    opponentLastChance: {
      awayScore: 76,
      chanceType: "tie",
      clock: "00:00",
      eventText: "Beta misses the tying jumper at the horn.",
      homeScore: 78,
      outcomeType: "missed_shot",
      quarter: 4,
      teamName: "Beta",
      teamSide: "away",
    },
  });
  assert.ok(
    facts.summaryLines.includes(
      "Closing sequence: Alpha went ahead 78-76 with 00:08 left in the 4th quarter; Beta missed a tying shot at the horn.",
    ),
  );
});

test("buildGameDayRecapPlayByPlayFacts keeps close finishes grounded when no last chance is identifiable", () => {
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
      clock: "01:58",
      eventText: "Alpha takes a narrow lead.",
      homeScore: 4,
      id: 1,
      quarter: 4,
      wallClock: 5,
    }),
    createEvent({
      awayScore: 4,
      clock: "01:45",
      eventText: "Beta draws level.",
      homeScore: 4,
      id: 2,
      quarter: 4,
      wallClock: 10,
    }),
    createEvent({
      awayScore: 4,
      clock: "00:11",
      eventText: "Alpha takes the lead for good.",
      homeScore: 6,
      id: 3,
      quarter: 4,
      wallClock: 15,
    }),
  ]);

  assert.equal(facts.endingFacts.opponentLastChance, null);
  assert.ok(
    facts.summaryLines.includes(
      "Late-game swings: Beta tied it at 4-4 with 01:45 left in the 4th quarter; Alpha went ahead 6-4 with 00:11 left in the 4th quarter.",
    ),
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

  const lastLateGameMoment = facts.lateGameMoments.at(-1);
  assert.equal(lastLateGameMoment?.quarter, 5);
  assert.ok(
    facts.summaryLines.includes(
      "Late-game swings: Alpha tied it at 2-2 with 00:10 left in the 4th quarter; Alpha went ahead 4-2 with 00:42 left in overtime.",
    ),
  );
});
