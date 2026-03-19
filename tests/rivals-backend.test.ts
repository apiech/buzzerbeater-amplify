import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../amplify/data/_backend/rivals";

test("classifyScheduleMatchType maps league TV games to regular season", () => {
  const result = __testing.classifyScheduleMatchType("LEAGUE.RS.TV");

  assert.equal(result.competitionKey, "LEAGUE_REGULAR_SEASON");
  assert.equal(result.competitionLabel, "League regular season");
  assert.equal(result.isTvGame, true);
  assert.equal(result.stageLabel, "Regular season");
});

test("classifyScheduleMatchType maps league semifinal to playoffs", () => {
  const result = __testing.classifyScheduleMatchType("LEAGUE.SEMIFINAL");

  assert.equal(result.competitionKey, "PLAYOFFS");
  assert.equal(result.competitionLabel, "Playoffs");
  assert.equal(result.isTvGame, false);
  assert.equal(result.stageLabel, "Semifinal");
});

test("classifyScheduleMatchType maps cup round labels", () => {
  const result = __testing.classifyScheduleMatchType("CUP.ROUND4");

  assert.equal(result.competitionKey, "CUP");
  assert.equal(result.stageLabel, "Round 4");
});

test("buildRivalryMatch shapes a completed head-to-head result", () => {
  const match = __testing.buildRivalryMatch({
    match: {
      awayTeam: {
        id: "2",
        score: 88,
        teamName: "Road Testers",
      },
      homeTeam: {
        id: "1",
        score: 96,
        teamName: "Home Club",
      },
      id: "match-1",
      startTime: "2026-03-01T19:00:00Z",
      type: "LEAGUE.RS.TV",
    },
    season: 61,
    teamId: "1",
  });

  assert.ok(match);
  assert.equal(match.matchId, "match-1");
  assert.equal(match.competitionKey, "LEAGUE_REGULAR_SEASON");
  assert.equal(match.gameDate, "2026-03-01");
  assert.equal(match.isHome, true);
  assert.equal(match.isTvGame, true);
  assert.equal(match.margin, 8);
  assert.equal(match.opponentTeamId, "2");
  assert.equal(match.opponentTeamName, "Road Testers");
  assert.equal(match.outcome, "WIN");
  assert.equal(match.season, 61);
  assert.equal(match.teamScore, 96);
  assert.equal(match.opponentScore, 88);
  assert.equal(match.venue, "HOME");
});
