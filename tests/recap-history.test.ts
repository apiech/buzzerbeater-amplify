import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSingleGameSummaryRecord } from "../app/server/recap-history";

test("normalizeSingleGameSummaryRecord preserves interview overrides and stored interview metadata", () => {
  const normalized = normalizeSingleGameSummaryRecord({
    completedAt: "2026-03-15T23:10:00.000Z",
    costJson: null,
    coverageJson: null,
    createdAt: "2026-03-15T23:00:00.000Z",
    error: null,
    failureJson: null,
    gameDate: "2026-03-15",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: "137828772",
    requestJson: JSON.stringify({
      approach: "FACT_LIBRARY_FIRST",
      interviewIntensity: "full_heat",
      loserInterviewPersonalityType: "rambling",
      matchId: "137828772",
      modelJudgeEnabled: true,
      mode: "SINGLE_GAME",
      qualityTier: "premium",
      winnerInterviewPersonalityType: "reflective",
    }),
    requestedAt: "2026-03-15T23:00:00.000Z",
    resultJson: JSON.stringify({
      games: [
        {
          evidenceTags: ["late_game_swing"],
          headline: "Visionaries close strong",
          matchId: "137828772",
          postgameInterview: {
            personalitySource: "request_override",
            personalityType: "reflective",
            playerName: "Hal Home",
            qa: [
              {
                answer: "Heraclitus said everything flows.",
                question: "What was working for you tonight?",
              },
            ],
            teamName: "Visionaries",
            teamSide: "home",
            title: "Hal Home on Visionaries's win",
          },
          postgameInterviews: [
            {
              personalitySource: "request_override",
              personalityType: "reflective",
              playerName: "Hal Home",
              qa: [
                {
                  answer: "Heraclitus said everything flows.",
                  question: "What was working for you tonight?",
                },
              ],
              teamName: "Visionaries",
              teamSide: "home",
              title: "Hal Home on Visionaries's win",
            },
            {
              personalitySource: "request_override",
              personalityType: "rambling",
              playerName: "Ari Away",
              qa: [
                {
                  answer:
                    "The door kept swinging open just wide enough for us to reclaim it.",
                  question: "Where did this one get away from you?",
                },
              ],
              teamName: "Delta 9",
              teamSide: "away",
              title: "Ari Away on Delta 9's response",
            },
          ],
          writeup:
            "Visionaries held the late edge and kept Delta 9 from reclaiming the game in the last possessions.",
        },
      ],
      summary: {
        headline: "Visionaries close strong",
        lede: "A stored recap row should keep both the request debug settings and the applied interview metadata.",
      },
    }),
    season: 64,
    status: "SUCCEEDED",
    targetKey:
      "137828772#fact-library-first#quality-premium#intensity-full-heat#winner-voice-reflective#loser-voice-rambling#model-judge",
    updatedAt: "2026-03-15T23:10:00.000Z",
    userId: "u1",
  } as any);

  assert.deepStrictEqual(normalized.requestJson, {
    approach: "FACT_LIBRARY_FIRST",
    interviewIntensity: "full_heat",
    loserInterviewPersonalityType: "rambling",
    matchId: "137828772",
    modelJudgeEnabled: true,
    mode: "SINGLE_GAME",
    qualityTier: "premium",
    winnerInterviewPersonalityType: "reflective",
  });
  const resultGame = normalized.resultJson.games[0];

  assert.equal(resultGame.postgameInterview.personalityType, "reflective");
  assert.equal(resultGame.postgameInterview.personalitySource, "request_override");
  assert.deepStrictEqual(
    resultGame.postgameInterviews?.map((interview) => ({
      personalitySource: interview.personalitySource,
      personalityType: interview.personalityType,
      teamSide: interview.teamSide,
    })),
    [
      {
        personalitySource: "request_override",
        personalityType: "reflective",
        teamSide: "home",
      },
      {
        personalitySource: "request_override",
        personalityType: "rambling",
        teamSide: "away",
      },
    ],
  );
});
