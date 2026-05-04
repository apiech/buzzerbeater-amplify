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
              {
                answer: "The fourth quarter was a river with elbows.",
                question: "Where did the finish start to move your way?",
              },
              {
                answer: "I would ask the scoreboard to stop wearing robes.",
                question:
                  "If the scoreboard briefly turned into a courtroom, what evidence would you want thrown out?",
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
                {
                  answer: "The fourth quarter was a river with elbows.",
                  question: "Where did the finish start to move your way?",
                },
                {
                  answer: "I would ask the scoreboard to stop wearing robes.",
                  question:
                    "If the scoreboard briefly turned into a courtroom, what evidence would you want thrown out?",
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
  assert.equal(resultGame.postgameInterview.qa.length, 3);
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

test("normalizeSingleGameSummaryRecord preserves simple fact-library approach", () => {
  const normalized = normalizeSingleGameSummaryRecord({
    completedAt: null,
    costJson: null,
    coverageJson: null,
    createdAt: "2026-05-03T20:42:00.000Z",
    error: null,
    failureJson: null,
    gameDate: "2026-05-02",
    leagueId: "100",
    leagueName: "NBBA",
    matchId: "138836864",
    requestJson: JSON.stringify({
      approach: "SIMPLE_FACT_LIBRARY",
      interviewIntensity: "none",
      matchId: "138836864",
      mode: "SINGLE_GAME",
      qualityTier: "standard",
    }),
    requestedAt: "2026-05-03T20:42:00.000Z",
    resultJson: null,
    season: null,
    status: "PROCESSING",
    targetKey:
      "138836864#simple-fact-library#quality-standard#intensity-none",
    updatedAt: "2026-05-03T20:42:00.000Z",
    userId: "u1",
  } as any);

  assert.equal(normalized.requestJson.approach, "SIMPLE_FACT_LIBRARY");
  assert.equal(normalized.requestJson.interviewIntensity, "none");
});
