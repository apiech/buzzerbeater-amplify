import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as recapTesting,
  hasActiveGameDayRecap,
  hasActiveRecapHistory,
  resolveDefaultRecapDate,
  resolveRecapInputMaxDate,
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
    playerLabPlayers: [],
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
    costJson: null,
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
  requestJson?: RecapHistoryRecord["requestJson"];
  selectionKey: string;
  status: RecapHistoryRecord["status"];
  targetKey: string;
  updatedAt: string;
}): RecapHistoryRecord {
  return {
    completedAt: null,
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: args.kind ?? "LEAGUE_DATE",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: args.requestJson ?? {},
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

test("resolveDefaultRecapDate tolerates missing recent matches and falls back to today", () => {
  const context = {
    ...createContext(),
    recentMatches: undefined,
  } as unknown as RecapPanelContext;

  assert.equal(
    resolveDefaultRecapDate(context),
    resolveRecapInputMaxDate("America/New_York"),
  );
});

test("recap submission stays blocked while the panel context is still hydrating", () => {
  const context = {
    ...createContext(),
    recentMatches: undefined,
  } as unknown as RecapPanelContext;

  assert.equal(
    recapTesting.resolveSubmissionBlockReason({
      context,
      gameDate: "2026-03-15",
      gameDayNumber: "1",
      historyLoaded: false,
      leagueId: "100",
      leagueTimeZone: "America/New_York",
      matchId: "",
      mode: "LEAGUE_DATE",
    }),
    "Recap tools are still loading. Try again in a moment.",
  );
});

test("performances stay available when premium writeups are locked", () => {
  assert.equal(
    recapTesting.resolveSubmissionBlockReason({
      branch: "WRITEUPS",
      canUseLeagueWriteups: false,
      context: createContext(),
      gameDate: "2026-03-15",
      gameDayNumber: "22",
      historyLoaded: true,
      isLoadingLeagueWriteupAccess: false,
      leagueId: "100",
      leagueTimeZone: "America/New_York",
      matchId: "",
      mode: "LEAGUE_GAME_DAY",
      season: "",
    }),
    "AI writeups require Premium. Switch to Performances for the free league game-day report.",
  );

  assert.equal(
    recapTesting.resolveSubmissionBlockReason({
      branch: "PERFORMANCES",
      canUseLeagueWriteups: false,
      context: createContext(),
      gameDate: "2026-03-15",
      gameDayNumber: "22",
      historyLoaded: true,
      isLoadingLeagueWriteupAccess: false,
      leagueId: "100",
      leagueTimeZone: "America/New_York",
      matchId: "",
      mode: "LEAGUE_GAME_DAY",
      season: "",
    }),
    null,
  );
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
  const nowMs = Date.parse("2026-03-15T23:05:00Z");

  assert.equal(
    hasActiveGameDayRecap(
      [
        createRecapRecord({
          requestedAt: "2026-03-15T22:00:00Z",
          status: "SUCCEEDED",
          targetKey: "done",
        }),
      ],
      nowMs,
    ),
    false,
  );

  assert.equal(
    hasActiveGameDayRecap(
      [
        createRecapRecord({
          requestedAt: "2026-03-15T23:00:00Z",
          status: "BUILDING_CONTEXT",
          targetKey: "working",
        }),
      ],
      nowMs,
    ),
    true,
  );
});

test("hasActiveRecapHistory detects non-terminal recap work", () => {
  const nowMs = Date.parse("2026-03-15T23:05:00Z");

  assert.equal(
    hasActiveRecapHistory(
      [
        createRecapHistoryRecord({
          selectionKey: "LEAGUE_DATE:done",
          status: "SUCCEEDED",
          targetKey: "done",
          updatedAt: "2026-03-15T22:00:00Z",
        }),
      ],
      nowMs,
    ),
    false,
  );

  assert.equal(
    hasActiveRecapHistory(
      [
        createRecapHistoryRecord({
          kind: "SINGLE_GAME",
          selectionKey: "SINGLE_GAME:working",
          status: "QUEUED",
          targetKey: "working",
          updatedAt: "2026-03-15T23:00:00Z",
        }),
      ],
      nowMs,
    ),
    true,
  );
});

test("stale non-terminal recap rows stop counting as active work", () => {
  const nowMs = Date.parse("2026-03-15T23:25:00Z");

  assert.equal(
    hasActiveRecapHistory(
      [
        createRecapHistoryRecord({
          kind: "SINGLE_GAME",
          selectionKey: "SINGLE_GAME:working",
          status: "QUEUED",
          targetKey: "working",
          updatedAt: "2026-03-15T23:00:00Z",
        }),
      ],
      nowMs,
    ),
    false,
  );
  assert.equal(
    hasActiveGameDayRecap(
      [
        createRecapRecord({
          requestedAt: "2026-03-15T23:00:00Z",
          status: "BUILDING_CONTEXT",
          targetKey: "working",
        }),
      ],
      nowMs,
    ),
    false,
  );
});

test("stale non-terminal recap rows render timeout status and fallback error copy", () => {
  const staleRecord = createRecapHistoryRecord({
    kind: "LEAGUE_DATE",
    selectionKey: "LEAGUE_DATE:working",
    status: "GENERATING",
    targetKey: "working",
    updatedAt: "2026-03-15T23:00:00Z",
  });
  const nowMs = Date.parse("2026-03-15T23:25:00Z");

  assert.equal(recapTesting.isLocallyTimedOutRecap(staleRecord, nowMs), true);
  assert.equal(recapTesting.formatRecapStatus(staleRecord, nowMs), "Writeup timed out");
  assert.match(
    recapTesting.getRecapDisplayError(staleRecord, nowMs) ?? "",
    /timed out/i,
  );

  const failedRecord = {
    ...staleRecord,
    status: "FAILED" as const,
  };
  assert.equal(recapTesting.isLocallyTimedOutRecap(failedRecord, nowMs), false);
  assert.equal(recapTesting.formatRecapStatus(failedRecord, nowMs), "Writeup failed");
});

test("recap cost helpers surface per-game estimates in list and detail copy", () => {
  const costJson = {
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    currency: "USD",
    estimatedPerGameCostUsd: 0.00775,
    estimatedTotalCostUsd: 0.0155,
    generatedGameCount: 2,
    inputTokens: 3000,
    outputTokens: 700,
    pricingStatus: "estimated",
    requestCount: 2,
    stages: [
      {
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        estimatedCostUsd: 0.0135,
        inputTokens: 2000,
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        outputTokens: 500,
        providerName: "bedrock",
        requestCount: 1,
        stage: "writer",
        totalTokens: 2500,
      },
    ],
    totalTokens: 3700,
  } as const;

  assert.equal(
    recapTesting.formatRecapCostListSnippet(costJson),
    "Est. $0.00775/game",
  );
  assert.equal(
    recapTesting.formatRecapCostSummary(costJson),
    "Estimated cost: $0.0155 total • $0.00775 per game summary • 2 model requests • 3,700 tokens",
  );
  assert.equal(
    recapTesting.formatRecapCostBreakdownLabel(costJson),
    "Cost breakdown • estimated",
  );
  assert.equal(
    recapTesting.formatRecapCostPricingStatusLabel(costJson.pricingStatus),
    "Estimated",
  );
  assert.equal(
    recapTesting.formatRecapCostStageSummary(costJson.stages[0]),
    "Writer • Est. $0.0135 • 1 request • 2,500 tokens",
  );
  assert.equal(
    recapTesting.formatRecapCostStageDetail(costJson.stages[0]),
    "Model: us.anthropic.claude-sonnet-4-5-20250929-v1:0 • Input 2,000 • Output 500",
  );
});

test("model fact review defaults off and submitRecapRequest forwards the toggle to league-date writeups", async () => {
  assert.equal(recapTesting.DEFAULT_MODEL_JUDGE_ENABLED, false);

  let submittedInput: Record<string, unknown> | null = null;

  const result = await recapTesting.submitRecapRequest(
    {
      approach: "FACT_LIBRARY_FIRST",
      branch: "WRITEUPS",
      canUseLeagueWriteups: true,
      context: createContext(),
      gameDate: "2026-03-15",
      gameDayNumber: "1",
      interviewIntensity: "full_heat",
      leagueId: "100",
      leagueTimeZone: "America/New_York",
      loserInterviewPersonalityType: "",
      matchId: "",
      modelJudgeEnabled: true,
      mode: "LEAGUE_DATE",
      qualityTier: "AUTO",
      season: "",
      winnerInterviewPersonalityType: "",
    },
    {
      setBbLeagueTimeZone: async () => {
        throw new Error("time zone should already match the current context");
      },
      submitGameDayRecap: async (input) => {
        submittedInput = input as Record<string, unknown>;
        return {
          executionArn: "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-date",
          targetKey: "100#2026-03-15#fact-library-first#model-judge",
        };
      },
      submitLeagueGameDayPerformances: async () => {
        throw new Error("performances mutation should not be called");
      },
      submitLeagueGameDayRecap: async () => {
        throw new Error("league game day mutation should not be called");
      },
      submitSingleGameSummary: async () => {
        throw new Error("single-game mutation should not be called");
      },
    },
  );

  assert.deepStrictEqual(result, {
    kind: "LEAGUE_DATE",
    targetKey: "100#2026-03-15#fact-library-first#model-judge",
  });
  assert.deepStrictEqual(submittedInput, {
    approach: "FACT_LIBRARY_FIRST",
    gameDate: "2026-03-15",
    interviewIntensity: "full_heat",
    leagueId: "100",
    leagueTimeZone: "America/New_York",
    modelJudgeEnabled: true,
  });
});

test("submitRecapRequest forwards non-empty single-game interview voice overrides", async () => {
  let submittedInput: Record<string, unknown> | null = null;

  const result = await recapTesting.submitRecapRequest(
    {
      approach: "FACT_LIBRARY_FIRST",
      branch: "WRITEUPS",
      canUseLeagueWriteups: true,
      context: createContext(),
      gameDate: "2026-03-15",
      gameDayNumber: "1",
      interviewIntensity: "pg13",
      leagueId: "100",
      leagueTimeZone: "America/New_York",
      loserInterviewPersonalityType: "curt",
      matchId: "137828772",
      modelJudgeEnabled: false,
      mode: "SINGLE_GAME",
      qualityTier: "AUTO",
      season: "",
      winnerInterviewPersonalityType: "deadpan",
    },
    {
      setBbLeagueTimeZone: async () => {
        throw new Error("time zone mutation should not be called");
      },
      submitGameDayRecap: async () => {
        throw new Error("league-date mutation should not be called");
      },
      submitLeagueGameDayPerformances: async () => {
        throw new Error("performances mutation should not be called");
      },
      submitLeagueGameDayRecap: async () => {
        throw new Error("league game day mutation should not be called");
      },
      submitSingleGameSummary: async (input) => {
        submittedInput = input as Record<string, unknown>;
        return {
          executionArn:
            "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single-game",
          targetKey:
            "137828772#fact-library-first#winner-voice-deadpan#loser-voice-curt",
        };
      },
    },
  );

  assert.deepStrictEqual(result, {
    kind: "SINGLE_GAME",
    targetKey:
      "137828772#fact-library-first#winner-voice-deadpan#loser-voice-curt",
  });
  assert.deepStrictEqual(submittedInput, {
    approach: "FACT_LIBRARY_FIRST",
    interviewIntensity: "pg13",
    loserInterviewPersonalityType: "curt",
    matchId: "137828772",
    modelJudgeEnabled: false,
    winnerInterviewPersonalityType: "deadpan",
  });
});

test("recap validation helpers partition deterministic and judge issues", () => {
  const issues = [
    {
      field: "writeup",
      kind: "wrong_final_score",
      reason: "Score mismatch",
      sentence: "Alpha won 90-80.",
      sentenceIndex: 0,
      source: "deterministic",
    },
    {
      field: "headline",
      kind: "other",
      reason: "Unsupported headline angle",
      sentence: "Alpha stuns Beta",
      sentenceIndex: 0,
      source: "judge",
    },
  ] as const;

  const partitioned = recapTesting.partitionRecapValidationIssues(issues);

  assert.equal(partitioned.deterministic.length, 1);
  assert.equal(partitioned.judge.length, 1);
  assert.equal(partitioned.deterministic[0]?.source, "deterministic");
  assert.equal(partitioned.judge[0]?.source, "judge");
});

test("recap validation summary explains deterministic-only warnings when judge was disabled", () => {
  assert.equal(
    recapTesting.buildRecapValidationAlertSummary({
      hasDeterministicWarnings: true,
      hasJudgeWarnings: false,
      modelJudgeEnabled: false,
    }),
    "Deterministic fact checks flagged issues in this recap. The extra model fact review was turned off for this request.",
  );
});

test("recap validation summary explains judge-only and mixed-source warnings", () => {
  assert.equal(
    recapTesting.buildRecapValidationAlertSummary({
      hasDeterministicWarnings: false,
      hasJudgeWarnings: true,
      modelJudgeEnabled: true,
    }),
    "The extra model fact review flagged issues in this recap.",
  );
  assert.equal(
    recapTesting.buildRecapValidationAlertSummary({
      hasDeterministicWarnings: true,
      hasJudgeWarnings: true,
      modelJudgeEnabled: true,
    }),
    "Deterministic fact checks and the extra model fact review both flagged issues in this recap.",
  );
});

test("didRecapRequestRunModelJudge reads the viewed recap request state", () => {
  assert.equal(
    recapTesting.didRecapRequestRunModelJudge(
      createRecapHistoryRecord({
        kind: "SINGLE_GAME",
        requestJson: {
          modelJudgeEnabled: true,
        },
        selectionKey: "SINGLE_GAME:judged",
        status: "SUCCEEDED",
        targetKey: "judged",
        updatedAt: "2026-03-15T23:10:00Z",
      }),
    ),
    true,
  );

  assert.equal(
    recapTesting.didRecapRequestRunModelJudge(
      createRecapHistoryRecord({
        kind: "SINGLE_GAME",
        requestJson: {
          modelJudgeEnabled: false,
        },
        selectionKey: "SINGLE_GAME:unchecked",
        status: "SUCCEEDED",
        targetKey: "unchecked",
        updatedAt: "2026-03-15T23:10:00Z",
      }),
    ),
    false,
  );
});

test("non-prod recap interview debug state prefers stored interview metadata over player lab defaults", () => {
  const storedDebugState = recapTesting.resolveRecapInterviewPersonalityDebugState({
    context: {
      ...createContext(),
      playerLabPlayers: [
        {
          age: 25,
          bestPosition: "SF",
          dmi: 1000,
          fullName: "Home Hero",
          gameShape: "proficient",
          injuryWeeks: 0,
          interviewPersonalitySource: "user_override",
          interviewPersonalityType: "deadpan",
          nationalityName: "USA",
          playerId: "p-1",
          ppg: 22,
          projectedStarterCount: 5,
          recentAvgMinutes: 38,
          recentStartCount: 5,
          salary: 12000,
        },
      ],
    },
    interview: {
      personalitySource: "request_override",
      personalityType: "reflective",
      playerName: "Home Hero",
      teamName: "Home",
    },
  });
  assert.deepStrictEqual(storedDebugState, {
    sourceLabel: "Debug override",
    typeLabel: "Reflective",
  });
});

test("non-prod recap interview debug state falls back to player lab and auto for legacy recaps", () => {
  const playerLabDebugState = recapTesting.resolveRecapInterviewPersonalityDebugState({
    context: {
      ...createContext(),
      playerLabPlayers: [
        {
          age: 25,
          bestPosition: "SF",
          dmi: 1000,
          fullName: "Home Hero",
          gameShape: "proficient",
          injuryWeeks: 0,
          interviewPersonalitySource: "user_override",
          interviewPersonalityType: "deadpan",
          nationalityName: "USA",
          playerId: "p-1",
          ppg: 22,
          projectedStarterCount: 5,
          recentAvgMinutes: 38,
          recentStartCount: 5,
          salary: 12000,
        },
      ],
    },
    interview: {
      playerName: "Home Hero",
      teamName: "Home",
    },
  });
  assert.deepStrictEqual(playerLabDebugState, {
    sourceLabel: "Custom",
    typeLabel: "Deadpan",
  });

  const fallbackDebugState = recapTesting.resolveRecapInterviewPersonalityDebugState({
    context: createContext(),
    interview: {
      playerName: "Road Spark",
      teamName: "Away",
    },
  });
  assert.equal(typeof fallbackDebugState?.typeLabel, "string");
  assert.equal(fallbackDebugState?.sourceLabel, "Auto");
});

test("history filtering keeps writeups and performances in separate lanes", () => {
  const mixedHistory = [
    createRecapHistoryRecord({
      selectionKey: "LEAGUE_DATE:gd-1",
      status: "SUCCEEDED",
      targetKey: "gd-1",
      updatedAt: "2026-03-15T22:00:00Z",
    }),
    {
      completedAt: "2026-04-12T01:02:00.000Z",
      coverageJson: null,
      error: null,
      gameDate: "2026-04-11",
      gameDayNumber: 22,
      kind: "LEAGUE_GAME_DAY_PERFORMANCES",
      leagueId: "100",
      leagueName: "Elite League",
      matchId: null,
      requestJson: {
        gameDayNumber: 22,
        leagueId: "100",
        mode: "LEAGUE_GAME_DAY_PERFORMANCES",
        season: 71,
      },
      requestedAt: "2026-04-12T01:00:00.000Z",
      resultJson: null,
      season: 71,
      selectionKey: "LEAGUE_GAME_DAY_PERFORMANCES:perf-1",
      status: "SUCCEEDED",
      targetKey: "perf-1",
      updatedAt: "2026-04-12T01:02:00.000Z",
    } satisfies RecapHistoryRecord,
  ];

  assert.deepStrictEqual(
    recapTesting
      .filterRecapHistoryForBranch(mixedHistory, "WRITEUPS")
      .map((record) => record.kind),
    ["LEAGUE_DATE"],
  );
  assert.deepStrictEqual(
    recapTesting
      .filterRecapHistoryForBranch(mixedHistory, "PERFORMANCES")
      .map((record) => record.kind),
    ["LEAGUE_GAME_DAY_PERFORMANCES"],
  );
});

test("recap labels prefer headlines and league/date copy over raw ids", () => {
  const record = {
    completedAt: "2026-03-15T23:15:00Z",
    coverageJson: null,
    costJson: null,
    error: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: "SINGLE_GAME",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: "137828772",
    requestJson: {
      interviewIntensity: "full_heat",
    },
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
  assert.match(recapTesting.describeRecapRecord(record), /Full heat voice/);
  assert.doesNotMatch(recapTesting.describeRecapRecord(record), /137828772/);
});

test("forum formatter builds BBCode with recap metadata and match links", () => {
  const record = {
    completedAt: "2026-03-15T23:15:00Z",
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: "LEAGUE_DATE",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: {
      approach: "FACT_LIBRARY_FIRST",
    },
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
        postgameInterview: {
          playerName: "Ari Alpha",
          qa: [
            {
              answer: "We stayed patient and trusted the defense.",
              question: "What changed in the fourth quarter?",
            },
          ],
          teamName: "Alpha",
          teamSide: "home",
          title: "Ari Alpha on Alpha's finish",
        },
        surpriseFactor: 8.7,
        writeup:
          "Alpha prepared well before tipoff.\n\nAlpha handled Beta in the fourth quarter.",
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
  assert.match(forumPost, /\[i]Elite League .*2026-03-15.*\[\/i]/);
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
  assert.match(
    forumPost,
    /Alpha prepared well before tipoff\.\n\nAlpha handled Beta in the fourth quarter\./,
  );
  assert.match(forumPost, /\[i]Ari Alpha • Alpha\[\/i]/);
  assert.doesNotMatch(forumPost, /Fact library first/i);
  assert.doesNotMatch(forumPost, /Classic recap engine/i);
  assert.doesNotMatch(forumPost, /FACT_LIBRARY_FIRST/i);
  assert.match(forumPost, /Match: \[match=137828772]/);
  assert.match(forumPost, /Match: scrim-like/);
});

test("splitRecapWriteupParagraphs falls back to readable story sections", () => {
  const paragraphs = recapTesting.splitRecapWriteupParagraphs(
    "Both teams prepared well for Outside looks. On pace, Away prepared for Fast pace, but Home played Motion. Home led 42-38 at halftime. Home used a 14-3 run from 08:00 left in the 3rd quarter to 04:35 left in the 3rd quarter. Ari Away led Away with 24 points, 6 rebounds, and 7 assists. Home held the stronger perimeter defense rating to close the win.",
  );

  assert.equal(paragraphs.length, 3);
  assert.match(paragraphs[0] ?? "", /prepared well/i);
  assert.match(paragraphs[1] ?? "", /halftime.*14-3 run/i);
  assert.match(paragraphs[2] ?? "", /Ari Away.*perimeter defense/i);
});

test("forum formatter includes suspect recaps but omits unsafe recaps from public copy", () => {
  const record = {
    completedAt: "2026-03-15T23:15:00Z",
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: "LEAGUE_DATE",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: {
      approach: "FACT_LIBRARY_FIRST",
    },
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
        headline: "Alpha closes strong",
        matchId: "137828772",
        surpriseFactor: 4.2,
        validation: {
          issueCount: 0,
          issues: [],
          status: "VALID",
        },
        writeup: "Alpha handled Beta in the fourth quarter.",
      },
      {
        evidenceTags: [],
        headline: "Gamma wins with a messy middle",
        matchId: "137828773",
        surpriseFactor: 9.5,
        postgameInterview: {
          playerName: "Gina Gamma",
          qa: [
            {
              answer: "We had to stop making it weird and play through contact.",
              question: "How did you steady the game late?",
            },
          ],
          teamName: "Gamma",
          teamSide: "home",
          title: "Gina Gamma on Gamma's late push",
        },
        validation: {
          issueCount: 1,
          issues: [
            {
              field: "writeup",
              kind: "choppy_fact_stack",
              reason: "The writeup stacked short fact sentences.",
              sentence: "Gamma led at halftime. Gamma won the third.",
              sentenceIndex: 0,
              source: "deterministic",
            },
          ],
          status: "SUSPECT",
        },
        writeup: "Gamma led at halftime. Gamma won the third.",
      },
      {
        evidenceTags: [],
        headline: "Delta wins with unsupported score",
        matchId: "137828774",
        surpriseFactor: 8.1,
        validation: {
          issueCount: 1,
          issues: [
            {
              field: "headline",
              kind: "wrong_final_score",
              reason: "The headline used a final score that does not match the box score.",
              sentence: "Delta wins with unsupported score",
              sentenceIndex: 0,
              source: "deterministic",
            },
          ],
          status: "UNSAFE",
        },
        writeup: "Delta beat Echo 101-99.",
      },
    ],
    summary: {
      gameOfTheDayMatchId: "137828773",
      gameOfTheDaySurpriseFactor: 9.5,
      headline: "Elite League roundup",
      lede: "One game is ready for public copy and one needs review.",
    },
  });

  assert.match(forumPost, /\[b]Alpha closes strong\[\/b]/);
  assert.match(forumPost, /Game of the day: Gamma wins with a messy middle/);
  assert.match(forumPost, /\[b]Gamma wins with a messy middle\[\/b]/);
  assert.match(forumPost, /Gamma led at halftime\. Gamma won the third\./);
  assert.match(forumPost, /\[i]Gina Gamma • Gamma\[\/i]/);
  assert.match(forumPost, /How did you steady the game late\?/);
  assert.doesNotMatch(forumPost, /Delta wins with unsupported score/);
  assert.doesNotMatch(forumPost, /101-99/);
  assert.doesNotMatch(forumPost, /\[match=137828774]/);
  assert.match(forumPost, /1 game recap was omitted because it has an unsafe validation warning/);
  assert.doesNotMatch(forumPost, /Fact library first/i);
});

test("forum formatter includes every interview in postgameInterviews while keeping legacy recaps readable", () => {
  const record = {
    completedAt: "2026-03-15T23:15:00Z",
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: "2026-03-15",
    gameDayNumber: null,
    kind: "LEAGUE_DATE",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: {
      approach: "FACT_LIBRARY_FIRST",
    },
    requestedAt: "2026-03-15T23:00:00Z",
    resultJson: null,
    season: null,
    selectionKey: "LEAGUE_DATE:100#2026-03-15",
    status: "SUCCEEDED",
    targetKey: "100#2026-03-15#model-judge",
    updatedAt: "2026-03-15T23:10:00Z",
  } as const;

  const forumPost = recapTesting.formatRecapForumPost(record, {
    games: [
      {
        evidenceTags: [],
        headline: "Alpha survives the opener",
        matchId: "137828772",
        postgameInterviews: [
          {
            playerName: "Ari Alpha",
            qa: [
              {
                answer: "We stayed patient and trusted the defense.",
                question: "What changed in the fourth quarter?",
              },
              {
                answer:
                  "If momentum needed a job title, I would call it night manager.",
                question:
                  "If tonight's momentum had to file paperwork, what would it list as its occupation?",
              },
            ],
            teamName: "Alpha",
            teamSide: "home",
            title: "Ari Alpha on Alpha's finish",
          },
          {
            playerName: "Bex Beta",
            qa: [
              {
                answer: "We have to handle that late swing better in Game 2.",
                question: "Where did the game turn?",
              },
            ],
            teamName: "Beta",
            teamSide: "away",
            title: "Bex Beta on what changed late",
          },
        ],
        surpriseFactor: 6.4,
        writeup:
          "Alpha settled the game late after a tense middle stretch kept the opener close.",
      },
    ],
    summary: {
      gameOfTheDayMatchId: "137828772",
      gameOfTheDaySurpriseFactor: 6.4,
      headline: "Elite League roundup",
      lede: "Game 1 finished with enough tension to support voices from both locker rooms.",
    },
  });

  assert.match(forumPost, /\[i]Ari Alpha • Alpha\[\/i]/);
  assert.match(forumPost, /\[i]Bex Beta • Beta\[\/i]/);
  assert.match(forumPost, /If tonight's momentum had to file paperwork/);
  assert.match(forumPost, /Where did the game turn\?/);
  assert.match(forumPost, /We have to handle that late swing better in Game 2\./);
});

test("performances forum formatter builds the planned sections, ties, and match links", () => {
  const record = {
    completedAt: "2026-04-12T01:02:00.000Z",
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: "2026-04-11",
    gameDayNumber: 22,
    kind: "LEAGUE_GAME_DAY_PERFORMANCES",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    requestJson: {
      gameDayNumber: 22,
      leagueId: "100",
      mode: "LEAGUE_GAME_DAY_PERFORMANCES",
      season: 71,
    },
    requestedAt: "2026-04-12T01:00:00.000Z",
    resultJson: null,
    season: 71,
    selectionKey: "LEAGUE_GAME_DAY_PERFORMANCES:perf-1",
    status: "SUCCEEDED",
    targetKey: "perf-1",
    updatedAt: "2026-04-12T01:02:00.000Z",
  } as const;

  const playerA = {
    efficiency: 31,
    minutes: 38,
    personalFouls: 2,
    playerId: "p-a",
    playerName: "Jules Alpha",
    position: "PG",
    rating: 14.5,
    statLine: {
      assists: 10,
      blocks: 0,
      points: 12,
      rebounds: 14,
      steals: 3,
    },
    teamId: "alpha",
    teamName: "Alpha",
    turnovers: 2,
  } as const;
  const playerB = {
    efficiency: 36,
    minutes: 36,
    personalFouls: 1,
    playerId: "p-b",
    playerName: "Drew Delta",
    position: "SG",
    rating: 20.5,
    statLine: {
      assists: 2,
      blocks: 0,
      points: 44,
      rebounds: 5,
      steals: 1,
    },
    teamId: "delta",
    teamName: "Delta",
    turnovers: 6,
  } as const;

  const forumPost = recapTesting.formatLeagueGameDayPerformancesForumPost(
    record,
    {
      badPerformance: {
        key: "bad-performance",
        label: "Bad performance",
        leaders: [playerA],
        value: -9,
      },
      gameDate: "2026-04-11",
      gameDayNumber: 22,
      games: [
        {
          awayScore: 81,
          awayTeamName: "Delta",
          homeScore: 91,
          homeTeamName: "Gamma",
          matchId: "137828772",
        },
      ],
      leagueId: "100",
      leagueName: "Elite League",
      mvp: {
        key: "mvp",
        label: "MVP",
        leaders: [playerB],
        value: 36,
      },
      playerLeaders: [
        {
          key: "points",
          label: "Points",
          leaders: [playerA, playerB],
          value: 44,
        },
      ],
      season: 71,
      statCallouts: [
        {
          key: "turnovers",
          label: "Most turnovers",
          leaders: [playerA, playerB],
          value: 6,
        },
      ],
      teamLeaders: [
        {
          key: "offense",
          label: "Offense",
          leaders: [
            { teamId: "gamma", teamName: "Gamma" },
            { teamId: "delta", teamName: "Delta" },
          ],
          value: 91,
        },
      ],
      topFive: [
        {
          key: "pg",
          label: "Point Guard",
          leaders: [playerA],
          position: "PG",
          value: 31,
        },
      ],
      tripleDoubles: [playerA],
    },
  );

  assert.match(
    forumPost,
    /^\[u]\[b]Game day 22 \(2026-04-11\) performances\[\/b]\[\/u]/,
  );
  assert.match(forumPost, /\[b]Night results\[\/b]/);
  assert.match(forumPost, /\[b]Best team performances of the evening\[\/b]/);
  assert.match(forumPost, /\[b]Best player performances of the evening\[\/b]/);
  assert.match(forumPost, /\[b]Top five of the evening\[\/b]/);
  assert.match(forumPost, /\[b]MVP of the evening\[\/b]/);
  assert.match(forumPost, /\[b]Bad performance of the evening\[\/b]/);
  assert.match(forumPost, /\[b]Triple-doubles of the evening\[\/b]/);
  assert.match(forumPost, /\[b]All kinds of statistics\[\/b]/);
  assert.match(forumPost, /\[match=137828772]/);
  assert.match(
    forumPost,
    /Jules Alpha \(Alpha\) - PG, Drew Delta \(Delta\) - SG/,
  );
  assert.doesNotMatch(forumPost, /buzzer-manager\.com/i);
});

test("recap capability copy mentions public play-by-play availability", () => {
  assert.match(
    recapTesting.RECAP_CAPABILITY_SUMMARY,
    /public play-by-play moments when available/i,
  );
  assert.doesNotMatch(
    recapTesting.RECAP_CAPABILITY_SUMMARY,
    /play-by-play are intentionally excluded/i,
  );
});
