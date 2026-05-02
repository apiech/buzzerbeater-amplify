"use client";

import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { Schema } from "@/amplify/data/resource";
import { client } from "@/app/amplify-client";
import { formatAmplifyErrors } from "@/app/dashboard/remote-errors";
import { isThemeId, type ThemeId } from "@/app/theme";
import type {
  AccessibleMatchSummary,
  ArenaWorkspacePayload,
  BillingPaymentsPage,
  BillingSummary,
  BbConnectionRecord,
  ConnectBbAccountInput,
  ConnectBbAccountResult,
  CurrentPredictionPreview,
  DisconnectBbAccountResult,
  HomeWorkspacePayload,
  LeagueHistoryAuditPayload,
  LeagueHistoryPayload,
  LeagueIntelPayload,
  LeagueSeasonSimulationSnapshot,
  LineupHelperEvaluationRecord,
  LineupHelperWorkspaceRecord,
  MatchBoxscorePayload,
  ManualSalaryEstimate,
  NextGamePlannerDetailPayload,
  NextGameRecommendationInput,
  NextGameRecommendationSnapshot,
  OperationsActivity,
  OpponentForecastSnapshot,
  PredictionDraft,
  PredictionSubmissionRequest,
  PredictionMatrixResult,
  PredictionSideInput,
  PlayerLabPayload,
  PlayerTrendPayload,
  RepairOwnerRosterDataResult,
  RecapGenerationApproach,
  RecapHistoryRecord,
  RecapInterviewIntensity,
  SubmitLeagueGameDayPerformancesResult,
  SubmitLeagueSeasonSimulationJobResult,
  RivalsWorkspacePayload,
  SalaryCalculatorSeed,
  SalaryCalculatorSkillsInput,
  SalaryProjection,
  ScoutSchedulePayload,
  ScoutTeamSummaryPayload,
  SetBbLeagueTimeZoneResult,
  SetTrackedPlayerInterviewPersonalityResult,
  SubmitLeagueGameDayRecapResult,
  SubmitGameDayRecapResult,
  SubmitLeagueHistoryBackfillResult,
  SubmitMyTeamHighlightsScanResult,
  SubmitNextGameRecommendationJobResult,
  SubmitOpponentForecastJobResult,
  SubmitPredictionJobResult,
  SubmitProductFeedbackInput,
  SubmitProductFeedbackResult,
  SubmitRivalsBackfillResult,
  SubmitSingleGameSummaryResult,
  TeamHighlightsPayload,
} from "@/app/types";
import {
  connectionResultSchema,
  homeNextMatchSchema,
  homeWorkspaceSchema,
  matchSummarySchema,
  namedReferenceSchema,
  playerSummarySchema,
  teamRecordSummarySchema,
  tendenciesSummarySchema,
} from "@/lib/owned-data/contracts";
import {
  INTERVIEW_PERSONALITY_TYPES,
  type InterviewPersonalityType,
} from "@/lib/interview-personalities";
import { currentPredictionPreviewSchema } from "@/lib/prediction/contracts";

const nullableStringSchema = z.string().nullable().optional();
const nullableNumberSchema = z.number().nullable().optional();
const nullableBooleanSchema = z.boolean().nullable().optional();
const themeIdSchema = z
  .string()
  .refine((value): value is ThemeId => isThemeId(value));

const lineupHelperDefensiveSwitchSchema = z
  .object({
    c: z.string(),
    pf: z.string(),
    pg: z.string(),
    sf: z.string(),
    sg: z.string(),
  })
  .passthrough();

const lineupHelperContextSchema = z
  .object({
    defense: z.string(),
    defensiveSwitch: lineupHelperDefensiveSwitchSchema,
    enthusiasm: z.number(),
    homeCourt: z.string(),
    offense: z.string(),
  })
  .passthrough();

const lineupHelperAssignmentSchema = z
  .object({
    minutes: z.number(),
    playerId: z.string(),
    position: z.string(),
  })
  .passthrough();

const lineupHelperSkillsSchema = z
  .object({
    dr: z.number(),
    ex: z.number(),
    ft: z.number(),
    gs: z.number(),
    ha: z.number(),
    id: z.number(),
    is: z.number(),
    jr: z.number(),
    js: z.number(),
    od: z.number(),
    pa: z.number(),
    rb: z.number(),
    sb: z.number(),
    st: z.number(),
  })
  .passthrough();

const lineupHelperRosterPlayerSchema = z
  .object({
    age: nullableNumberSchema,
    available: z.boolean(),
    bestPosition: nullableStringSchema,
    dmi: nullableNumberSchema,
    fullName: z.string(),
    gameShape: nullableStringSchema,
    injuryWeeks: nullableNumberSchema,
    playerId: z.string(),
    salary: nullableNumberSchema,
    skills: lineupHelperSkillsSchema,
    snapshotCapturedAt: nullableStringSchema,
    snapshotWarning: nullableStringSchema,
    snapshotWeekKey: nullableStringSchema,
  })
  .passthrough();

const lineupHelperRatingValuesSchema = z
  .object({
    insideDefense: z.number(),
    insideScoring: z.number(),
    offensiveFlow: z.number(),
    outsideDefense: z.number(),
    outsideScoring: z.number(),
    rebounding: z.number(),
  })
  .passthrough();

const lineupHelperRatingLabelsSchema = z
  .object({
    insideDefense: z.string(),
    insideScoring: z.string(),
    offensiveFlow: z.string(),
    outsideDefense: z.string(),
    outsideScoring: z.string(),
    rebounding: z.string(),
  })
  .passthrough();

const lineupHelperRankingEntrySchema = z
  .object({
    name: z.string(),
    output: z.number(),
    playerId: z.string(),
  })
  .passthrough();

const lineupHelperPositionOutputSchema = z
  .object({
    c: z.number(),
    pf: z.number(),
    pg: z.number(),
    sf: z.number(),
    sg: z.number(),
  })
  .passthrough();

const lineupHelperPlayerPositionOutputSchema = z
  .object({
    output: lineupHelperPositionOutputSchema,
    playerId: z.string(),
  })
  .passthrough();

const lineupHelperPositionRankingsSchema = z
  .object({
    c: z.array(lineupHelperRankingEntrySchema),
    pf: z.array(lineupHelperRankingEntrySchema),
    pg: z.array(lineupHelperRankingEntrySchema),
    sf: z.array(lineupHelperRankingEntrySchema),
    sg: z.array(lineupHelperRankingEntrySchema),
  })
  .passthrough();

const lineupHelperPerPositionContributionsSchema = z
  .object({
    insideDefense: lineupHelperPositionOutputSchema,
    insideScoring: lineupHelperPositionOutputSchema,
    offensiveFlow: lineupHelperPositionOutputSchema,
    outsideDefense: lineupHelperPositionOutputSchema,
    outsideScoring: lineupHelperPositionOutputSchema,
    rebounding: lineupHelperPositionOutputSchema,
  })
  .passthrough();

const lineupHelperEvaluationSchema = z
  .object({
    context: lineupHelperContextSchema,
    normalizedLineup: z.array(lineupHelperAssignmentSchema),
    outputBandLabels: lineupHelperRatingLabelsSchema,
    perPositionContributions: lineupHelperPerPositionContributionsSchema,
    playerPositionOutputs: z.array(lineupHelperPlayerPositionOutputSchema),
    rankingVersion: z.string().optional(),
    rankings: lineupHelperPositionRankingsSchema,
    ratingLabels: lineupHelperRatingLabelsSchema,
    rawRatings: lineupHelperRatingValuesSchema,
    roundedRatings: lineupHelperRatingValuesSchema,
    totalOutput: z.number(),
    warnings: z.array(z.string()),
  })
  .passthrough();

const lineupHelperWorkspaceSchema = z
  .object({
    availableDefenses: z.array(z.string()),
    availableLocations: z.array(z.string()),
    availableOffenses: z.array(z.string()),
    defaultAssignments: z.array(lineupHelperAssignmentSchema),
    defaultContext: lineupHelperContextSchema,
    evaluation: lineupHelperEvaluationSchema.nullable().optional(),
    generatedAt: z.string(),
    roster: z.array(lineupHelperRosterPlayerSchema),
    snapshotWarnings: z.array(
      z
        .object({
          fullName: z.string(),
          playerId: z.string(),
          warning: z.string(),
        })
        .passthrough(),
    ),
    syncedAt: nullableStringSchema,
  })
  .passthrough();

const leagueIntelSchema = z
  .object({
    comparisons: z
      .object({
        arena: z.array(
          z
            .object({
              bleachers: nullableNumberSchema,
              conferenceIndex: z.number(),
              courtside: nullableNumberSchema,
              lowerTier: nullableNumberSchema,
              luxuryBoxes: nullableNumberSchema,
              standingsIndex: z.number(),
              teamId: nullableStringSchema,
              teamName: nullableStringSchema,
              totalCapacity: nullableNumberSchema,
            })
            .passthrough(),
        ),
        builtAt: z.string(),
        defense: z.array(
          z
            .object({
              blocks: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              conferenceIndex: z.number(),
              fouls: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              gamesPlayed: nullableNumberSchema,
              standingsIndex: z.number(),
              steals: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              teamId: nullableStringSchema,
              teamName: nullableStringSchema,
              totalRebounds: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              turnovers: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
            })
            .passthrough(),
        ),
        incompleteTeamCount: z.number(),
        offense: z.array(
          z
            .object({
              assists: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              conferenceIndex: z.number(),
              effectiveFgPct: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              fgPct: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              ftPct: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              gamesPlayed: nullableNumberSchema,
              offensiveRebounds: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              points: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
              standingsIndex: z.number(),
              teamId: nullableStringSchema,
              teamName: nullableStringSchema,
              threePtPct: z
                .object({
                  diff: nullableNumberSchema,
                  opponent: nullableNumberSchema,
                  team: nullableNumberSchema,
                })
                .passthrough()
                .nullable()
                .optional(),
            })
            .passthrough(),
        ),
        payroll: z.array(
          z
            .object({
              averageSalary: nullableNumberSchema,
              conferenceIndex: z.number(),
              payrollRanks6To10: nullableNumberSchema,
              playerCount: nullableNumberSchema,
              standingsIndex: z.number(),
              standardDeviation: nullableNumberSchema,
              teamId: nullableStringSchema,
              teamName: nullableStringSchema,
              top10Payroll: nullableNumberSchema,
              top5Payroll: nullableNumberSchema,
              top8Payroll: nullableNumberSchema,
              totalPayroll: nullableNumberSchema,
            })
            .passthrough(),
        ),
        season: nullableNumberSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
    freshnessMessage: nullableStringSchema,
    freshnessStatus: z.enum(["FRESH", "UNAVAILABLE"]),
    league: namedReferenceSchema,
    season: nullableNumberSchema,
    standings: z.array(
      z
        .object({
          index: z.number(),
          teams: z.array(
            z
              .object({
                losses: nullableNumberSchema,
                pointMargin: nullableNumberSchema,
                teamId: nullableStringSchema,
                teamName: nullableStringSchema,
                wins: nullableNumberSchema,
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough()
  .nullable()
  .optional();

const playerLabSchema = z
  .object({
    players: z.array(playerSummarySchema),
    syncedAt: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const arenaSeatStateSchema = z
  .object({
    section: z.string(),
    capacity: nullableNumberSchema,
    price: nullableNumberSchema,
    nextPrice: nullableNumberSchema,
    minPrice: z.number(),
    maxPrice: z.number(),
  })
  .passthrough();

const arenaExpansionSectionSchema = z
  .object({
    section: z.string(),
    capacityDelta: nullableNumberSchema,
  })
  .passthrough();

const arenaExpansionSchema = z
  .object({
    daysLeft: nullableNumberSchema,
    sections: z.array(arenaExpansionSectionSchema),
  })
  .passthrough()
  .nullable()
  .optional();

const arenaEconomyTransactionSchema = z
  .object({
    kind: nullableStringSchema,
    amount: nullableNumberSchema,
    date: nullableStringSchema,
    description: nullableStringSchema,
    rawType: nullableStringSchema,
    rawAmount: nullableStringSchema,
    rawDate: nullableStringSchema,
  })
  .passthrough();

const arenaWorkspaceSchema = z
  .object({
    syncedAt: nullableStringSchema,
    nextHomeMatch: homeNextMatchSchema,
    arena: z
      .object({
        name: nullableStringSchema,
        seats: z.array(arenaSeatStateSchema),
        expansion: arenaExpansionSchema,
      })
      .passthrough(),
    economy: z
      .object({
        cash: nullableNumberSchema,
        availableBalance: nullableNumberSchema,
        transactions: z.array(arenaEconomyTransactionSchema),
      })
      .passthrough(),
    recentHomeGames: z.array(
      z
        .object({
          matchId: nullableStringSchema,
          startTime: nullableStringSchema,
          type: nullableStringSchema,
          opponentTeamId: nullableStringSchema,
          opponentTeamName: nullableStringSchema,
          competitionKey: nullableStringSchema,
          competitionLabel: nullableStringSchema,
          estimatedRealizedGate: nullableNumberSchema,
          matchedSnapshotCapturedAt: nullableStringSchema,
          sections: z.array(
            z
              .object({
                section: z.string(),
                attendance: nullableNumberSchema,
                capacity: nullableNumberSchema,
                price: nullableNumberSchema,
                occupancyPct: nullableNumberSchema,
                realizedRevenue: nullableNumberSchema,
                usedMatchedSnapshot: z.boolean(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
    recommendation: z
      .object({
        overallConfidence: nullableNumberSchema,
        heuristicDisclaimer: nullableStringSchema,
        projectedCurrentRevenue: nullableNumberSchema,
        projectedRecommendedRevenue: nullableNumberSchema,
        projectedRevenueDelta: nullableNumberSchema,
        sections: z.array(
          z
            .object({
              section: z.string(),
              currentPrice: nullableNumberSchema,
              recommendedPrice: nullableNumberSchema,
              delta: nullableNumberSchema,
              reason: nullableStringSchema,
              confidence: nullableNumberSchema,
              weightedOccupancyPct: nullableNumberSchema,
              projectedAttendance: nullableNumberSchema,
              projectedRevenue: nullableNumberSchema,
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .nullable()
      .optional(),
    diagnostics: z
      .object({
        comparableGameCount: z.number(),
        matchedSnapshotCount: z.number(),
        lowConfidenceReasons: z.array(z.string()),
      })
      .passthrough(),
  })
  .passthrough()
  .nullable()
  .optional();

const scoutOpponentSummarySchema = z
  .object({
    losses: nullableNumberSchema,
    pointMargin: nullableNumberSchema,
    teamId: nullableStringSchema,
    teamName: nullableStringSchema,
    wins: nullableNumberSchema,
  })
  .passthrough();

const scoutScheduleCompetitionOptionSchema = z
  .object({
    count: z.number(),
    key: z.string(),
    label: z.string(),
    selectedByDefault: z.boolean(),
  })
  .passthrough();

const scoutScheduleRowSchema = z
  .object({
    competitionKey: nullableStringSchema,
    competitionLabel: nullableStringSchema,
    hasBoxscore: nullableBooleanSchema,
    isTvGame: nullableBooleanSchema,
    matchId: nullableStringSchema,
    opponentBbStatsTotal: nullableNumberSchema,
    opponentDefense: nullableStringSchema,
    opponentOffense: nullableStringSchema,
    opponentScore: nullableNumberSchema,
    opponentTeamId: nullableStringSchema,
    opponentTeamName: nullableStringSchema,
    outcome: nullableStringSchema,
    season: nullableNumberSchema,
    seriousness: nullableStringSchema,
    seriousnessReason: nullableStringSchema,
    seriousnessScore: nullableNumberSchema,
    stageLabel: nullableStringSchema,
    startTime: nullableStringSchema,
    teamBbStatsTotal: nullableNumberSchema,
    teamDefense: nullableStringSchema,
    teamOffense: nullableStringSchema,
    teamScore: nullableNumberSchema,
    venue: nullableStringSchema,
  })
  .passthrough();

const scoutScheduleSchema = z
  .object({
    availableSeasons: z.array(z.number()),
    competitionOptions: z.array(scoutScheduleCompetitionOptionSchema),
    rows: z.array(scoutScheduleRowSchema),
    selectedCompetitionKeys: z.array(z.string()),
    selectedSeason: z.number(),
    summary: z
      .object({
        completedGames: z.number(),
        seriousGames: z.number(),
        totalGames: z.number(),
        upcomingGames: z.number(),
      })
      .passthrough(),
  })
  .passthrough()
  .nullable()
  .optional();

const scoutWorkspaceSchema = z
  .object({
    availableOpponents: z.array(scoutOpponentSummarySchema),
    message: nullableStringSchema,
    recentMatchups: z.array(matchSummarySchema),
    requestedTeamId: nullableStringSchema,
    schedule: scoutScheduleSchema,
    summary: z
      .object({
        matchupPerspective: z
          .object({
            opponentTeamId: nullableStringSchema,
            ourTeamId: nullableStringSchema,
          })
          .passthrough(),
        nextMatch: matchSummarySchema.nullable().optional(),
        recentGames: z.array(matchSummarySchema),
        record: teamRecordSummarySchema,
        roster: z.array(playerSummarySchema),
        tendencies: tendenciesSummarySchema,
        teamName: nullableStringSchema,
        topPlayers: z.array(playerSummarySchema),
      })
      .passthrough()
      .nullable()
      .optional(),
    syncedAt: nullableStringSchema,
    teamId: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const opponentForecastPlayerProjectionSchema = z
  .object({
    bestPosition: nullableStringSchema,
    expectedMinutes: nullableNumberSchema,
    fullName: z.string(),
    gameShape: nullableStringSchema,
    injuryWeeks: nullableNumberSchema,
    minuteBandHigh: nullableNumberSchema,
    minuteBandLow: nullableNumberSchema,
    playerId: nullableStringSchema,
    starterProbability: nullableNumberSchema,
  })
  .passthrough();

const opponentForecastSchema = z
  .object({
    completedAt: nullableStringSchema,
    error: nullableStringSchema,
    executionArn: nullableStringSchema,
    jobId: z.string(),
    modelVersion: nullableStringSchema,
    requestedAt: z.string(),
    result: z
      .object({
        analogGames: z.array(
          z
            .object({
              defense: nullableStringSchema,
              effortDelta: nullableNumberSchema,
              gdpFocus: nullableStringSchema,
              gdpPace: nullableStringSchema,
              matchId: z.string(),
              offense: nullableStringSchema,
              opponentScore: nullableNumberSchema,
              opponentTeamName: nullableStringSchema,
              season: nullableNumberSchema,
              similarity: z.number(),
              startTime: nullableStringSchema,
              teamScore: nullableNumberSchema,
            })
            .passthrough(),
        ),
        confidence: z.number(),
        coverage: z
          .object({
            analogGamesConsidered: z.number(),
            headToHeadGamesConsidered: z.number(),
            recentGamesConsidered: z.number(),
            rosterPlayersConsidered: z.number(),
            sampleStrategy: z.string(),
            seriousGamesConsidered: z.number(),
            supportingGamesConsidered: z.number(),
          })
          .passthrough(),
        featureSignals: z.array(
          z
            .object({
              key: z.string(),
              label: z.string(),
              strength: nullableNumberSchema,
              value: z.string(),
            })
            .passthrough(),
        ),
        generatedAt: z.string(),
        modelVersion: z.string(),
        topScenarios: z.array(
          z
            .object({
              defense: z.string(),
              effortChoice: z.string(),
              enthusiasmBand: nullableStringSchema,
              evidence: z.array(z.string()),
              gdpFocus: nullableStringSchema,
              gdpPace: nullableStringSchema,
              label: z.string(),
              offense: z.string(),
              probability: z.number(),
              rotation: z.array(opponentForecastPlayerProjectionSchema),
              scenarioId: z.string(),
              starters: z.array(opponentForecastPlayerProjectionSchema),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .nullable()
      .optional(),
    startedAt: nullableStringSchema,
    status: z.string(),
    teamId: z.string(),
    teamName: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const nextGameRecommendationPlanScenarioResultSchema = z
  .object({
    available: z.boolean(),
    predictedOpponentScore: nullableNumberSchema,
    predictedPointDiff: nullableNumberSchema,
    predictedTeamScore: nullableNumberSchema,
    scenarioId: z.string(),
  })
  .passthrough();

const nextGameRecommendationPlanSchema = z
  .object({
    ceilingPointDiff: nullableNumberSchema,
    defense: z.string(),
    defensiveSwitch: lineupHelperDefensiveSwitchSchema,
    effortChoice: z.string(),
    enthusiasm: z.number(),
    floorPointDiff: nullableNumberSchema,
    lineup: z.array(
      z
        .object({
          fullName: z.string(),
          minutes: z.number(),
          playerId: nullableStringSchema,
          position: z.string(),
        })
        .passthrough(),
    ),
    meetsTargetMargin: z.boolean(),
    mode: z.string(),
    offense: z.string(),
    pairId: z.string().optional(),
    predictedOpponentScore: z.number(),
    predictedPointDiff: z.number(),
    predictedTeamScore: z.number(),
    scenarioResults: z
      .array(nextGameRecommendationPlanScenarioResultSchema)
      .optional(),
    targetMargin: nullableNumberSchema,
    weightedExpectedPointDiff: nullableNumberSchema,
    winProbability: nullableNumberSchema,
  })
  .passthrough();

const nextGameRecommendationScenarioSchema = z
  .object({
    defense: z.string(),
    effortChoice: z.string(),
    evidence: z.array(z.string()),
    label: z.string(),
    offense: z.string(),
    probability: z.number(),
    scenarioId: z.string(),
  })
  .passthrough();

const nextGamePlannerTacticPairSchema = z
  .object({
    defense: z.string(),
    estimated: z.boolean(),
    offense: z.string(),
    pairId: z.string(),
    supportTier: z.enum(["DIRECT", "ESTIMATED"]),
  })
  .passthrough();

const nextGamePlannerCellSchema = z
  .object({
    available: z.boolean(),
    opponentPairId: z.string(),
    ourPairId: z.string(),
    predictedOpponentScore: nullableNumberSchema,
    predictedPointDiff: nullableNumberSchema,
    predictedTeamScore: nullableNumberSchema,
  })
  .passthrough();

const nextGamePlannerRowSchema = z
  .object({
    cells: z.array(nextGamePlannerCellSchema),
    opponentPairId: z.string(),
  })
  .passthrough();

const nextGamePlannerViewSchema = z
  .object({
    label: z.string(),
    probability: nullableNumberSchema,
    rows: z.array(nextGamePlannerRowSchema),
    scenarioId: nullableStringSchema,
    viewId: z.string(),
  })
  .passthrough();

const nextGamePlannerDetailSchema = z
  .object({
    artifactKey: z.string(),
    evaluatedScenarios: z.array(nextGameRecommendationScenarioSchema),
    generatedAt: z.string(),
    opponentPairs: z.array(nextGamePlannerTacticPairSchema),
    ourPairs: z.array(nextGamePlannerTacticPairSchema),
    views: z.array(nextGamePlannerViewSchema),
  })
  .passthrough()
  .nullable()
  .optional();

const nextGameRecommendationCompletedPhaseSchema = z
  .object({
    completedAt: z.string(),
    durationMs: z.number(),
    phaseKey: z.string(),
    startedAt: z.string(),
    summary: z.string(),
  })
  .passthrough();

const nextGameRecommendationProgressContextSchema = z
  .object({
    artifactKey: nullableStringSchema,
    availableRosterCount: nullableNumberSchema,
    candidateCount: nullableNumberSchema,
    excludedPlayerCount: nullableNumberSchema,
    forecastJobId: nullableStringSchema,
    forecastScenarioCount: nullableNumberSchema,
    plannerBatchCount: nullableNumberSchema,
    plannerBatchesCompleted: nullableNumberSchema,
    plannerPairCount: nullableNumberSchema,
    sourceMatchId: nullableStringSchema,
    sourceTeamLocation: nullableStringSchema,
    workspaceCacheKind: nullableStringSchema,
    workspaceCacheState: nullableStringSchema,
    workspaceSyncedAt: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const nextGameRecommendationProgressSchema = z
  .object({
    completedPhases: z.array(nextGameRecommendationCompletedPhaseSchema),
    completedUnits: nullableNumberSchema,
    context: nextGameRecommendationProgressContextSchema,
    currentPhaseStartedAt: nullableStringSchema,
    phaseCount: z.number(),
    phaseIndex: z.number(),
    phaseKey: z.string(),
    summary: z.string(),
    totalUnits: nullableNumberSchema,
    unitLabel: nullableStringSchema,
    updatedAt: z.string(),
  })
  .passthrough()
  .nullable()
  .optional();

const nextGameRecommendationSchema = z
  .object({
    completedAt: nullableStringSchema,
    defensiveSwitch: lineupHelperDefensiveSwitchSchema,
    excludedPlayerIds: z.array(z.string()).optional(),
    enthusiasm: z.number(),
    error: nullableStringSchema,
    executionArn: nullableStringSchema,
    jobId: z.string(),
    matchId: z.string(),
    opponentTeamId: z.string(),
    opponentTeamName: nullableStringSchema,
    progress: nextGameRecommendationProgressSchema,
    requestedAt: z.string(),
    result: z
      .object({
        artifactKey: nullableStringSchema,
        biggestWinPlan: nextGameRecommendationPlanSchema.optional(),
        bestExpectedPlan: nextGameRecommendationPlanSchema.optional(),
        efficientPlan: nextGameRecommendationPlanSchema.optional(),
        efficientWinPlan: nextGameRecommendationPlanSchema.optional(),
        evaluatedScenarios: z
          .array(nextGameRecommendationScenarioSchema)
          .optional(),
        forecastJobId: z.string(),
        forecastModelVersion: z.string(),
        forecastScenarioId: z.string(),
        forecastScenarioLabel: z.string(),
        forecastScenarioProbability: z.number(),
        generatedAt: z.string(),
        matchId: z.string(),
        excludedPlayerIds: z.array(z.string()).optional(),
        opponentSourceMatchId: z.string(),
        opponentTeamId: z.string(),
        opponentTeamName: z.string(),
        safestPlan: nextGameRecommendationPlanSchema.optional(),
        stale: z.boolean(),
      })
      .passthrough()
      .nullable()
      .optional(),
    startedAt: nullableStringSchema,
    status: z.string(),
  })
  .passthrough()
  .nullable()
  .optional();

const leagueSeasonSimulationCompletedPhaseSchema = z
  .object({
    completedAt: z.string(),
    durationMs: z.number(),
    phaseKey: z.string(),
    startedAt: z.string(),
    summary: z.string(),
  })
  .passthrough();

const leagueSeasonSimulationProgressContextSchema = z
  .object({
    candidateGameCount: nullableNumberSchema,
    currentSeason: nullableNumberSchema,
    lowSampleTeamCount: nullableNumberSchema,
    remainingGameCount: nullableNumberSchema,
    scoredGameCount: nullableNumberSchema,
    simulationCount: nullableNumberSchema,
    teamCount: nullableNumberSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const leagueSeasonSimulationProgressSchema = z
  .object({
    completedPhases: z.array(leagueSeasonSimulationCompletedPhaseSchema),
    completedUnits: nullableNumberSchema,
    context: leagueSeasonSimulationProgressContextSchema,
    currentPhaseStartedAt: nullableStringSchema,
    phaseCount: z.number(),
    phaseIndex: z.number(),
    phaseKey: z.string(),
    summary: z.string(),
    totalUnits: nullableNumberSchema,
    unitLabel: nullableStringSchema,
    updatedAt: z.string(),
  })
  .passthrough()
  .nullable()
  .optional();

const leagueSeasonSimulationFinishProbabilitySchema = z
  .object({
    place: z.number(),
    probability: z.number(),
  })
  .passthrough();

const leagueSeasonSimulationSourceSnapshotSchema = z
  .object({
    candidateGameCount: z.number(),
    defense: z.string(),
    offense: z.string(),
    sampleWarning: nullableStringSchema,
    selectionStrategy: z.enum([
      "BEST_AVAILABLE",
      "CURRENT_SEASON_15TH_PERCENTILE",
      "LEAGUE_AVERAGE_FALLBACK",
      "MULTI_SEASON_THIRD_BEST",
    ]),
    sourceMatchId: nullableStringSchema,
    sourceSeason: nullableNumberSchema,
    sourceStartTime: nullableStringSchema,
    teamId: z.string(),
    teamName: nullableStringSchema,
  })
  .passthrough();

const leagueSeasonSimulationTeamResultSchema = z
  .object({
    averageFinish: z.number(),
    currentLosses: z.number(),
    currentPointMargin: z.number(),
    currentWins: z.number(),
    expectedLosses: z.number(),
    expectedPointMargin: z.number(),
    expectedWins: z.number(),
    finishProbabilities: z.array(leagueSeasonSimulationFinishProbabilitySchema),
    firstPlaceProbability: z.number(),
    snapshot: leagueSeasonSimulationSourceSnapshotSchema,
    standingsIndex: z.number(),
    teamId: z.string(),
    teamName: nullableStringSchema,
    winsP10: z.number(),
    winsP50: z.number(),
    winsP90: z.number(),
  })
  .passthrough();

const leagueSeasonSimulationConferenceResultSchema = z
  .object({
    conferenceIndex: z.number(),
    teams: z.array(leagueSeasonSimulationTeamResultSchema),
  })
  .passthrough();

const leagueSeasonSimulationGameResultSchema = z
  .object({
    awayDefense: z.string(),
    awayOffense: z.string(),
    awayTeamId: z.string(),
    awayTeamName: nullableStringSchema,
    expectedAwayScore: z.number(),
    expectedHomeScore: z.number(),
    expectedMargin: z.number(),
    homeDefense: z.string(),
    homeOffense: z.string(),
    homeTeamId: z.string(),
    homeTeamName: nullableStringSchema,
    homeWinProbability: z.number(),
    matchId: z.string(),
    startTime: nullableStringSchema,
  })
  .passthrough();

const leagueSeasonSimulationResultSchema = z
  .object({
    conferences: z.array(leagueSeasonSimulationConferenceResultSchema),
    generatedAt: z.string(),
    leagueId: z.string(),
    leagueName: nullableStringSchema,
    lowSampleTeamCount: z.number(),
    modelVersion: nullableStringSchema,
    remainingGames: z.array(leagueSeasonSimulationGameResultSchema),
    residualSigma: z.number(),
    season: z.number(),
    simulationCount: z.number(),
  })
  .passthrough()
  .nullable()
  .optional();

const leagueSeasonSimulationSchema = z
  .object({
    completedAt: nullableStringSchema,
    error: nullableStringSchema,
    executionArn: nullableStringSchema,
    jobId: z.string(),
    leagueId: z.string(),
    leagueName: nullableStringSchema,
    progress: leagueSeasonSimulationProgressSchema,
    requestedAt: z.string(),
    result: leagueSeasonSimulationResultSchema,
    season: z.number(),
    startedAt: nullableStringSchema,
    status: z.string(),
    teamId: z.string(),
    teamName: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const syncRunSchema = z
  .object({
    completedAt: nullableStringSchema,
    error: nullableStringSchema,
    id: z.string(),
    kind: z.string(),
    startedAt: z.string(),
    status: z.string(),
  })
  .passthrough();

const gameDayRecapCoverageMissingGameSchema = z
  .object({
    awayTeamName: z.string(),
    homeTeamName: z.string(),
    matchId: z.string(),
    reason: z.string(),
  })
  .passthrough();

const gameDayRecapCoverageSchema = z
  .object({
    availableGames: z.number(),
    missingGames: z.array(gameDayRecapCoverageMissingGameSchema),
    partial: z.boolean(),
    requestedGames: z.number(),
  })
  .passthrough();

const gameDayRecapCostStageSchema = z
  .object({
    cacheReadInputTokens: nullableNumberSchema,
    cacheWriteInputTokens: nullableNumberSchema,
    estimatedCostUsd: nullableNumberSchema,
    inputTokens: z.number(),
    modelId: z.string(),
    outputTokens: z.number(),
    providerName: z.string(),
    requestCount: z.number(),
    stage: z.string(),
    totalTokens: z.number(),
  })
  .passthrough();

const gameDayRecapCostSchema = z
  .object({
    cacheReadInputTokens: nullableNumberSchema,
    cacheWriteInputTokens: nullableNumberSchema,
    currency: z.string(),
    estimatedPerGameCostUsd: nullableNumberSchema,
    estimatedTotalCostUsd: nullableNumberSchema,
    generatedGameCount: nullableNumberSchema,
    inputTokens: z.number(),
    outputTokens: z.number(),
    pricingStatus: z.string(),
    requestCount: z.number(),
    stages: z.array(gameDayRecapCostStageSchema),
    totalTokens: z.number(),
  })
  .passthrough();

const gameDayRecapValidationIssueSchema = z
  .object({
    actualValue: nullableStringSchema.optional(),
    feedback: nullableStringSchema.optional(),
    field: z.string(),
    kind: z.string(),
    reason: z.string(),
    sentence: z.string(),
    sentenceIndex: z.number(),
    source: z.string(),
    sourceField: nullableStringSchema.optional(),
    teamSide: nullableStringSchema.optional(),
    verdict: nullableStringSchema.optional(),
  })
  .passthrough();

const gameDayRecapGameValidationSchema = z
  .object({
    issueCount: z.number(),
    issues: z.array(gameDayRecapValidationIssueSchema),
    status: z.string(),
  })
  .passthrough();

const gameDayRecapFailureSchema = z
  .object({
    errorName: nullableStringSchema.optional(),
    failedGameCount: z.number(),
    games: z.array(
      z
        .object({
          awayTeamName: nullableStringSchema.optional(),
          homeTeamName: nullableStringSchema.optional(),
          issueCount: z.number(),
          issues: z.array(gameDayRecapValidationIssueSchema),
          matchId: nullableStringSchema.optional(),
        })
        .passthrough(),
    ),
    issueCount: z.number(),
    message: z.string(),
    repairActionCount: z.number(),
  })
  .passthrough();

const gameDayRecapResultSchema = z
  .object({
    games: z.array(
      z
        .object({
          evidenceTags: z.array(z.string()),
          headline: z.string(),
          matchId: z.string(),
          surpriseFactor: nullableNumberSchema,
          validation: gameDayRecapGameValidationSchema.nullable().optional(),
          writeup: z.string(),
        })
        .passthrough(),
    ),
    summary: z
      .object({
        gameOfTheDayMatchId: nullableStringSchema,
        gameOfTheDaySurpriseFactor: nullableNumberSchema,
        headline: z.string(),
        lede: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const gameDayRecapStoredRequestSchema = z
  .object({
    gameDate: z.string(),
    interviewIntensity: z.enum(["clean", "pg13", "full_heat"]).optional(),
    leagueId: z.string(),
    modelJudgeEnabled: z.boolean().optional(),
    mode: z.literal("FULL_SLATE"),
  })
  .passthrough();

const leagueGameDayRecapStoredRequestSchema = z
  .object({
    gameDayNumber: z.number(),
    interviewIntensity: z.enum(["clean", "pg13", "full_heat"]).optional(),
    leagueId: z.string(),
    modelJudgeEnabled: z.boolean().optional(),
    mode: z.literal("LEAGUE_GAME_DAY"),
    season: nullableNumberSchema,
  })
  .passthrough();

const leagueGameDayPerformancesStoredRequestSchema = z
  .object({
    gameDayNumber: z.number(),
    leagueId: z.string(),
    mode: z.literal("LEAGUE_GAME_DAY_PERFORMANCES"),
    season: nullableNumberSchema,
  })
  .passthrough();

const singleGameSummaryStoredRequestSchema = z
  .object({
    interviewIntensity: z.enum(["clean", "pg13", "full_heat"]).optional(),
    loserInterviewPersonalityType: z
      .enum(INTERVIEW_PERSONALITY_TYPES)
      .nullable()
      .optional(),
    matchId: z.string(),
    modelJudgeEnabled: z.boolean().optional(),
    mode: z.literal("SINGLE_GAME"),
    winnerInterviewPersonalityType: z
      .enum(INTERVIEW_PERSONALITY_TYPES)
      .nullable()
      .optional(),
  })
  .passthrough();

const leagueGameDayPerformancesStatLineSchema = z
  .object({
    assists: z.number(),
    blocks: z.number(),
    points: z.number(),
    rebounds: z.number(),
    steals: z.number(),
  })
  .passthrough();

const leagueGameDayPerformancesPlayerEntrySchema = z
  .object({
    efficiency: z.number(),
    minutes: z.number(),
    personalFouls: z.number(),
    playerId: nullableStringSchema,
    playerName: z.string(),
    position: z.string(),
    rating: nullableNumberSchema,
    statLine: leagueGameDayPerformancesStatLineSchema,
    teamId: nullableStringSchema,
    teamName: z.string(),
    turnovers: z.number(),
  })
  .passthrough();

const leagueGameDayPerformancesTeamEntrySchema = z
  .object({
    teamId: nullableStringSchema,
    teamName: z.string(),
  })
  .passthrough();

const leagueGameDayPerformancesGameSchema = z
  .object({
    awayScore: z.number(),
    awayTeamName: z.string(),
    homeScore: z.number(),
    homeTeamName: z.string(),
    matchId: z.string(),
  })
  .passthrough();

const leagueGameDayPerformancesPlayerLeaderboardSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    leaders: z.array(leagueGameDayPerformancesPlayerEntrySchema),
    unit: nullableStringSchema,
    value: z.number(),
  })
  .passthrough();

const leagueGameDayPerformancesTeamLeaderboardSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    leaders: z.array(leagueGameDayPerformancesTeamEntrySchema),
    unit: nullableStringSchema,
    value: z.number(),
  })
  .passthrough();

const leagueGameDayPerformancesPositionLeaderboardSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    leaders: z.array(leagueGameDayPerformancesPlayerEntrySchema),
    position: z.string(),
    value: z.number(),
  })
  .passthrough();

const leagueGameDayPerformancesResultSchema = z
  .object({
    badPerformance: leagueGameDayPerformancesPlayerLeaderboardSchema,
    gameDate: nullableStringSchema,
    gameDayNumber: z.number(),
    games: z.array(leagueGameDayPerformancesGameSchema),
    leagueId: z.string(),
    leagueName: nullableStringSchema,
    mvp: leagueGameDayPerformancesPlayerLeaderboardSchema,
    playerLeaders: z.array(leagueGameDayPerformancesPlayerLeaderboardSchema),
    season: nullableNumberSchema,
    statCallouts: z.array(leagueGameDayPerformancesPlayerLeaderboardSchema),
    teamLeaders: z.array(leagueGameDayPerformancesTeamLeaderboardSchema),
    topFive: z.array(leagueGameDayPerformancesPositionLeaderboardSchema),
    tripleDoubles: z.array(leagueGameDayPerformancesPlayerEntrySchema),
  })
  .passthrough();

const gameDayRecapRecordSchema = z
  .object({
    completedAt: nullableStringSchema,
    coverageJson: gameDayRecapCoverageSchema.nullable().optional(),
    costJson: gameDayRecapCostSchema.nullable().optional(),
    error: nullableStringSchema,
    failureJson: gameDayRecapFailureSchema.nullable().optional(),
    gameDate: nullableStringSchema,
    gameDayNumber: nullableNumberSchema,
    leagueId: nullableStringSchema,
    leagueName: nullableStringSchema,
    matchId: nullableStringSchema,
    requestJson: z
      .union([
        gameDayRecapStoredRequestSchema,
        leagueGameDayRecapStoredRequestSchema,
        leagueGameDayPerformancesStoredRequestSchema,
        singleGameSummaryStoredRequestSchema,
      ])
      .optional(),
    requestedAt: z.string(),
    resultJson: gameDayRecapResultSchema.nullable().optional(),
    status: nullableStringSchema,
    targetKey: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const singleGameSummarySchema = z
  .object({
    completedAt: nullableStringSchema,
    coverageJson: gameDayRecapCoverageSchema.nullable().optional(),
    costJson: gameDayRecapCostSchema.nullable().optional(),
    error: nullableStringSchema,
    failureJson: gameDayRecapFailureSchema.nullable().optional(),
    gameDate: nullableStringSchema,
    leagueId: nullableStringSchema,
    leagueName: nullableStringSchema,
    matchId: z.string(),
    requestJson: singleGameSummaryStoredRequestSchema.optional(),
    requestedAt: z.string(),
    resultJson: gameDayRecapResultSchema.nullable().optional(),
    status: nullableStringSchema,
    targetKey: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const operationsActivitySchema = z
  .object({
    currentPrediction: currentPredictionPreviewSchema.nullable(),
    gameDayRecaps: z.array(gameDayRecapRecordSchema),
    leagueGameDayRecaps: z.array(gameDayRecapRecordSchema),
    singleGameSummaries: z.array(singleGameSummarySchema),
    syncRuns: z.array(syncRunSchema),
  })
  .passthrough();

const recapHistoryRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      completedAt: nullableStringSchema,
      coverageJson: gameDayRecapCoverageSchema.nullable(),
      costJson: z.null().optional(),
      error: nullableStringSchema,
      failureJson: z.null().optional(),
      gameDate: nullableStringSchema,
      gameDayNumber: z.number(),
      kind: z.literal("LEAGUE_GAME_DAY_PERFORMANCES"),
      leagueId: nullableStringSchema,
      leagueName: nullableStringSchema,
      matchId: z.null(),
      requestJson: leagueGameDayPerformancesStoredRequestSchema,
      requestedAt: z.string(),
      resultJson: leagueGameDayPerformancesResultSchema.nullable(),
      season: nullableNumberSchema,
      selectionKey: z.string(),
      status: nullableStringSchema,
      targetKey: z.string(),
      updatedAt: z.string(),
    })
    .passthrough(),
  z
    .object({
      completedAt: nullableStringSchema,
      coverageJson: gameDayRecapCoverageSchema.nullable(),
      costJson: gameDayRecapCostSchema.nullable().optional(),
      error: nullableStringSchema,
      failureJson: gameDayRecapFailureSchema.nullable().optional(),
      gameDate: z.string(),
      gameDayNumber: z.null(),
      kind: z.literal("LEAGUE_DATE"),
      leagueId: nullableStringSchema,
      leagueName: nullableStringSchema,
      matchId: z.null(),
      requestJson: gameDayRecapStoredRequestSchema,
      requestedAt: z.string(),
      resultJson: gameDayRecapResultSchema.nullable(),
      season: nullableNumberSchema,
      selectionKey: z.string(),
      status: nullableStringSchema,
      targetKey: z.string(),
      updatedAt: z.string(),
    })
    .passthrough(),
  z
    .object({
      completedAt: nullableStringSchema,
      coverageJson: gameDayRecapCoverageSchema.nullable(),
      costJson: gameDayRecapCostSchema.nullable().optional(),
      error: nullableStringSchema,
      failureJson: gameDayRecapFailureSchema.nullable().optional(),
      gameDate: z.null(),
      gameDayNumber: z.number(),
      kind: z.literal("LEAGUE_GAME_DAY"),
      leagueId: nullableStringSchema,
      leagueName: nullableStringSchema,
      matchId: z.null(),
      requestJson: leagueGameDayRecapStoredRequestSchema,
      requestedAt: z.string(),
      resultJson: gameDayRecapResultSchema.nullable(),
      season: nullableNumberSchema,
      selectionKey: z.string(),
      status: nullableStringSchema,
      targetKey: z.string(),
      updatedAt: z.string(),
    })
    .passthrough(),
  z
    .object({
      completedAt: nullableStringSchema,
      coverageJson: gameDayRecapCoverageSchema.nullable(),
      costJson: gameDayRecapCostSchema.nullable().optional(),
      error: nullableStringSchema,
      failureJson: gameDayRecapFailureSchema.nullable().optional(),
      gameDate: nullableStringSchema,
      gameDayNumber: z.null(),
      kind: z.literal("SINGLE_GAME"),
      leagueId: nullableStringSchema,
      leagueName: nullableStringSchema,
      matchId: z.string(),
      requestJson: singleGameSummaryStoredRequestSchema,
      requestedAt: z.string(),
      resultJson: gameDayRecapResultSchema.nullable(),
      season: nullableNumberSchema,
      selectionKey: z.string(),
      status: nullableStringSchema,
      targetKey: z.string(),
      updatedAt: z.string(),
    })
    .passthrough(),
]);

const paginatedRecapHistorySchema = z
  .object({
    items: z.array(recapHistoryRecordSchema),
    nextToken: nullableStringSchema,
  })
  .passthrough();

const leagueHistoryRowSchema = z
  .object({
    averageMargin: z.number(),
    championships: z.number(),
    games: z.number(),
    losses: z.number(),
    pa: z.number(),
    pf: z.number(),
    playoffLosses: z.number(),
    playoffWins: z.number(),
    pointMargin: z.number(),
    seasons: z.number(),
    teamId: z.string(),
    teamName: z.string(),
    winPct: z.number(),
    wins: z.number(),
  })
  .passthrough();

const leagueHistoryStatusSchema = z
  .object({
    completedAt: nullableStringSchema,
    error: nullableStringSchema,
    executionArn: nullableStringSchema,
    historicalSeasonsExpected: nullableNumberSchema,
    historicalSeasonsStored: nullableNumberSchema,
    lastCompletedSeason: nullableNumberSchema,
    leagueId: z.string(),
    leagueName: nullableStringSchema,
    requestedAt: z.string(),
    startedAt: nullableStringSchema,
    status: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const leagueHistorySchema = z
  .object({
    league: namedReferenceSchema,
    requestedLeagueId: nullableStringSchema,
    rows: z.array(leagueHistoryRowSchema),
    status: leagueHistoryStatusSchema.nullable().optional(),
    summary: z
      .object({
        currentSeason: nullableNumberSchema,
        historicalSeasonsStored: z.number(),
        totalTeams: z.number(),
      })
      .passthrough(),
    warning: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const leagueHistoryAuditCollisionSchema = z
  .object({
    firstSeason: nullableNumberSchema,
    lastSeason: nullableNumberSchema,
    rowCount: z.number(),
    seasonCount: z.number(),
    teamId: z.string(),
    teamNames: z.array(z.string()),
  })
  .passthrough();

const leagueHistoryAuditMismatchSchema = z
  .object({
    cachedTeamName: z.string(),
    liveTeamName: z.string(),
    season: z.number(),
    teamId: z.string(),
  })
  .passthrough();

const leagueHistoryAuditSchema = z
  .object({
    cachedRows: z.array(leagueHistoryRowSchema),
    league: namedReferenceSchema,
    liveComparisonIncluded: z.boolean(),
    liveRows: z.array(leagueHistoryRowSchema),
    mixedNameTeams: z.array(leagueHistoryAuditCollisionSchema),
    nameMismatches: z.array(leagueHistoryAuditMismatchSchema),
    requestedLeagueId: nullableStringSchema,
    warning: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const teamHighlightsBrokenMatchSchema = z
  .object({
    awayTeamName: nullableStringSchema,
    boxscoreUrl: z.string(),
    homeTeamName: nullableStringSchema,
    issue: z.string(),
    matchId: z.string(),
    matchType: nullableStringSchema,
    season: nullableNumberSchema,
    startTime: nullableStringSchema,
  })
  .passthrough();

const teamHighlightsScanStatusSchema = z
  .object({
    brokenMatches: z
      .array(teamHighlightsBrokenMatchSchema)
      .optional()
      .default([]),
    completedAt: nullableStringSchema,
    currentSeason: nullableNumberSchema,
    error: nullableStringSchema,
    errorCode: nullableStringSchema,
    executionArn: nullableStringSchema,
    matchesAlreadyRecorded: nullableNumberSchema,
    matchesCompleted: nullableNumberSchema,
    matchesDiscovered: nullableNumberSchema,
    matchesEnqueuedForIngest: nullableNumberSchema,
    matchesEnqueuedForMaterialize: nullableNumberSchema,
    matchesFailed: nullableNumberSchema,
    matchesProcessedThisRun: nullableNumberSchema,
    matchesReused: nullableNumberSchema,
    matchesWithMoments: nullableNumberSchema,
    matchesWithoutMoments: nullableNumberSchema,
    momentsWritten: nullableNumberSchema,
    requestedAt: z.string(),
    seasonsFrom: nullableNumberSchema,
    seasonsTo: nullableNumberSchema,
    startedAt: nullableStringSchema,
    status: z.string(),
    teamId: z.string(),
    teamName: nullableStringSchema,
    unsupportedSeasonsWarning: nullableStringSchema,
    updatedAt: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const teamHighlightsMomentSchema = z
  .object({
    comment: nullableStringSchema,
    eventKind: nullableStringSchema,
    finalOpponentScore: nullableNumberSchema,
    finalScoreAway: nullableNumberSchema,
    finalScoreHome: nullableNumberSchema,
    finalTeamScore: nullableNumberSchema,
    freeThrowType: nullableStringSchema,
    gameclock: nullableNumberSchema,
    isHome: nullableBooleanSchema,
    matchId: z.string(),
    matchType: nullableStringSchema,
    momentId: z.string(),
    opponentId: nullableStringSchema,
    opponentName: nullableStringSchema,
    opponentScore: nullableNumberSchema,
    overtime: nullableNumberSchema,
    period: nullableStringSchema,
    perspective: z.string(),
    playDescription: nullableStringSchema,
    scoreDiffBefore: nullableNumberSchema,
    scoreDiffAfter: nullableNumberSchema,
    scoreState: nullableStringSchema,
    season: nullableNumberSchema,
    startTime: nullableStringSchema,
    teamId: nullableStringSchema,
    teamName: nullableStringSchema,
    teamScore: nullableNumberSchema,
  })
  .passthrough();

const teamHighlightsSchema = z
  .object({
    filters: z
      .object({
        onlyOutcomeChange: z.boolean(),
        perspective: z.string(),
      })
      .passthrough(),
    items: z.array(teamHighlightsMomentSchema),
    nextCursor: nullableStringSchema,
    scanStatus: teamHighlightsScanStatusSchema,
    summary: z
      .object({
        againstMoments: z.number(),
        filteredMoments: z.number(),
        forMoments: z.number(),
        outcomeChangeMoments: z.number(),
        totalMoments: z.number(),
      })
      .passthrough(),
    team: z
      .object({
        teamId: nullableStringSchema,
        teamName: nullableStringSchema,
      })
      .passthrough(),
  })
  .passthrough()
  .nullable()
  .optional();

const billingSummarySchema = z
  .object({
    accessSource: z.string(),
    cancelAtPeriodEnd: nullableBooleanSchema,
    currentPeriodEndAt: nullableStringSchema,
    hasBillingCustomer: z.boolean(),
    hasLifetimeAccess: z.boolean(),
    lifetimeGrantedAt: nullableStringSchema,
    lifetimePurchaseOfferEnabled: z.boolean(),
    planId: z.string(),
    premiumSubscriptionOfferEnabled: z.boolean(),
    subscriptionStatus: nullableStringSchema,
  })
  .passthrough();

const billingPaymentEntrySchema = z
  .object({
    amountTotal: nullableNumberSchema,
    currency: nullableStringSchema,
    occurredAt: z.string(),
    paymentKind: z.string(),
    providerObjectId: z.string(),
    providerObjectType: z.string(),
    status: z.string(),
  })
  .passthrough();

const billingPaymentsPageSchema = z
  .object({
    items: z.array(billingPaymentEntrySchema),
    nextToken: nullableStringSchema,
  })
  .passthrough();

const matchMetricEntrySchema = z
  .object({
    key: z.string(),
    numberValue: z.number(),
  })
  .passthrough();

const matchBoxscorePlayerLineSchema = z
  .object({
    firstName: nullableStringSchema,
    fullName: z.string(),
    isStarter: z.boolean(),
    lastName: nullableStringSchema,
    minutes: nullableNumberSchema,
    minutesByPosition: z.array(matchMetricEntrySchema),
    performance: z.array(matchMetricEntrySchema),
    playerId: nullableStringSchema,
  })
  .passthrough();

const matchBoxscoreTeamRatingsSchema = z
  .object({
    insideDefense: z.number(),
    insideScoring: z.number(),
    offensiveFlow: z.number(),
    outsideDefense: z.number(),
    outsideScoring: z.number(),
    rebounding: z.number(),
  })
  .passthrough();

const matchBoxscoreTeamSchema = z
  .object({
    defStrategy: nullableStringSchema,
    efficiency: z.array(matchMetricEntrySchema),
    offStrategy: nullableStringSchema,
    partialScores: z.array(z.number()),
    players: z.array(matchBoxscorePlayerLineSchema),
    ratings: matchBoxscoreTeamRatingsSchema.nullable().optional(),
    score: nullableNumberSchema,
    shortName: nullableStringSchema,
    teamId: nullableStringSchema,
    teamName: nullableStringSchema,
    teamTotals: z.array(matchMetricEntrySchema),
  })
  .passthrough()
  .nullable()
  .optional();

const matchBoxscoreSchema = z
  .object({
    awayTeam: matchBoxscoreTeamSchema,
    context: z
      .object({
        awayTeamName: nullableStringSchema,
        effortDelta: nullableNumberSchema,
        homeTeamName: nullableStringSchema,
        neutral: nullableBooleanSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
    endTime: nullableStringSchema,
    homeTeam: matchBoxscoreTeamSchema,
    matchId: z.string(),
    matchType: nullableStringSchema,
    source: z.string(),
    startTime: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const accessibleMatchSummarySchema = z
  .object({
    ingestStatus: z.string(),
    matchId: z.string(),
    opponentScore: nullableNumberSchema,
    opponentTeamId: nullableStringSchema,
    opponentTeamName: nullableStringSchema,
    outcome: nullableStringSchema,
    season: nullableNumberSchema,
    startTime: nullableStringSchema,
    teamId: z.string(),
    teamScore: nullableNumberSchema,
    type: nullableStringSchema,
  })
  .passthrough();

const accessibleMatchListSchema = z.object({
  items: z.array(accessibleMatchSummarySchema),
  nextCursor: nullableStringSchema,
});

const predictionMatrixTacticPairSchema = z
  .object({
    defense: z.string(),
    estimated: z.boolean(),
    offense: z.string(),
    pairId: z.string(),
    supportTier: z.enum(["DIRECT", "ESTIMATED"]),
  })
  .passthrough();

const predictionMatrixCellSchema = z
  .object({
    available: z.boolean(),
    bestEffortChoice: nullableStringSchema,
    predictedPointDiff: nullableNumberSchema,
    predictedTeamAScore: nullableNumberSchema,
    predictedTeamBScore: nullableNumberSchema,
    teamAPairId: z.string(),
    teamBPairId: z.string(),
  })
  .passthrough();

const predictionMatrixRowSchema = z
  .object({
    cells: z.array(predictionMatrixCellSchema),
    teamBPairId: z.string(),
  })
  .passthrough();

const predictionMatrixViewSchema = z
  .object({
    label: z.string(),
    probability: nullableNumberSchema,
    rows: z.array(predictionMatrixRowSchema),
    scenarioId: nullableStringSchema,
    viewId: z.string(),
  })
  .passthrough();

const predictionMatrixSideSummarySchema = z
  .object({
    defense: z.string(),
    effortChoice: z.string(),
    offense: z.string(),
    teamId: nullableStringSchema,
    teamName: nullableStringSchema,
  })
  .passthrough();

const predictionMatrixResultSchema = z
  .object({
    generatedAt: z.string(),
    modelKey: nullableStringSchema,
    modelVersion: z.string(),
    selectedTeamAPairId: nullableStringSchema,
    selectedTeamBPairId: nullableStringSchema,
    teamAPairs: z.array(predictionMatrixTacticPairSchema),
    teamASide: predictionMatrixSideSummarySchema,
    teamBPairs: z.array(predictionMatrixTacticPairSchema),
    teamBSide: predictionMatrixSideSummarySchema,
    venue: z.enum(["TEAM_A_HOME", "NEUTRAL", "TEAM_B_HOME"]),
    views: z.array(predictionMatrixViewSchema),
  })
  .passthrough();

const playerTrendSchema = z
  .object({
    history: z.array(
      z
        .object({
          dmi: nullableNumberSchema,
          fetchedAt: nullableStringSchema,
          gameShape: nullableStringSchema,
          injuryWeeks: nullableNumberSchema,
          salary: nullableNumberSchema,
          weekKey: nullableStringSchema,
        })
        .passthrough(),
    ),
    player: playerSummarySchema,
  })
  .passthrough()
  .nullable()
  .optional();

const salaryProjectionSchema = z
  .object({
    bestPosition: nullableStringSchema,
    currentSalary: nullableNumberSchema,
    flagReason: nullableStringSchema,
    fullName: z.string(),
    isFlagTarget: z.boolean(),
    nationalityName: nullableStringSchema,
    playerId: z.string(),
    projectedSalary: nullableNumberSchema,
    trend: z.string(),
    weeklyDelta: z.number(),
  })
  .passthrough()
  .nullable()
  .optional();

const salaryCalculatorSkillsSchema = z
  .object({
    driving: z.number(),
    handling: z.number(),
    insideDefense: z.number(),
    insideScoring: z.number(),
    jumpRange: z.number(),
    jumpShot: z.number(),
    outsideDefense: z.number(),
    passing: z.number(),
    rebounding: z.number(),
    shotBlocking: z.number(),
  })
  .passthrough();

const salaryByPositionSchema = z
  .object({
    C: z.number(),
    PF: z.number(),
    PG: z.number(),
    SF: z.number(),
    SG: z.number(),
  })
  .passthrough();

const salaryCalculatorSeedSchema = z
  .object({
    bestPosition: nullableStringSchema,
    currentSalary: nullableNumberSchema,
    fullName: z.string(),
    playerId: z.string(),
    skills: salaryCalculatorSkillsSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const manualSalaryEstimateSchema = z
  .object({
    bestPosition: z.string(),
    calibrationMode: z.string(),
    correctionFactorApplied: z.number(),
    modelSource: z.string(),
    modelSourceConfidence: z.string(),
    predictedSalary: z.number(),
    salaryByPosition: salaryByPositionSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const rivalsBackfillStatusSchema = z
  .object({
    completedAt: nullableStringSchema,
    error: nullableStringSchema,
    executionArn: nullableStringSchema,
    generatedAt: nullableStringSchema,
    requestedAt: z.string(),
    startedAt: nullableStringSchema,
    status: z.string(),
    teamId: z.string(),
    teamName: nullableStringSchema,
    totalCompletedGames: nullableNumberSchema,
    totalOpponents: nullableNumberSchema,
    updatedAt: z.string(),
  })
  .passthrough()
  .nullable()
  .optional();

const rivalryMatchSchema = z
  .object({
    competitionKey: z.string(),
    competitionLabel: z.string(),
    gameDate: nullableStringSchema,
    isHome: z.boolean(),
    isTvGame: z.boolean(),
    margin: z.number(),
    matchId: z.string(),
    opponentScore: z.number(),
    opponentTeamId: z.string(),
    opponentTeamName: z.string(),
    outcome: z.string(),
    rawType: nullableStringSchema,
    season: z.number(),
    stageKey: nullableStringSchema,
    stageLabel: nullableStringSchema,
    startTime: nullableStringSchema,
    teamScore: z.number(),
    venue: z.string(),
  })
  .passthrough();

const rivalsCompetitionOptionSchema = z
  .object({
    count: z.number(),
    key: z.string(),
    label: z.string(),
  })
  .passthrough();

const rivalryRowSchema = z
  .object({
    averageMargin: z.number(),
    currentStreak: z.string(),
    games: z.number(),
    homeLosses: z.number(),
    homeWins: z.number(),
    lastMatch: nullableStringSchema,
    leagueLosses: z.number(),
    leagueWins: z.number(),
    losses: z.number(),
    opponentTeamId: z.string(),
    opponentTeamName: z.string(),
    playoffLosses: z.number(),
    playoffWins: z.number(),
    roadLosses: z.number(),
    roadWins: z.number(),
    seasons: z.array(z.number()),
    tvGames: z.number(),
    winPct: z.number(),
    wins: z.number(),
  })
  .passthrough();

const rivalryCompetitionBreakdownRowSchema = z
  .object({
    averageMargin: z.number(),
    competitionKey: z.string(),
    competitionLabel: z.string(),
    games: z.number(),
    homeLosses: z.number(),
    homeWins: z.number(),
    losses: z.number(),
    roadLosses: z.number(),
    roadWins: z.number(),
    tvGames: z.number(),
    wins: z.number(),
  })
  .passthrough();

const rivalrySeasonBreakdownRowSchema = z
  .object({
    averageMargin: z.number(),
    games: z.number(),
    lastMatch: nullableStringSchema,
    leagueLosses: z.number(),
    leagueWins: z.number(),
    losses: z.number(),
    season: z.number(),
    tvGames: z.number(),
    wins: z.number(),
  })
  .passthrough();

const rivalsWorkspaceSchema = z
  .object({
    competitionOptions: z.array(rivalsCompetitionOptionSchema),
    generatedAt: z.string(),
    rows: z.array(rivalryRowSchema),
    seasonRange: z
      .object({
        availableSeasons: z.array(z.number()),
        endSeason: nullableNumberSchema,
        startSeason: nullableNumberSchema,
      })
      .passthrough(),
    selectedOpponentId: nullableStringSchema,
    selectedRivalry: z
      .object({
        competitionBreakdown: z.array(rivalryCompetitionBreakdownRowSchema),
        matches: z.array(rivalryMatchSchema),
        row: rivalryRowSchema,
        seasonBreakdown: z.array(rivalrySeasonBreakdownRowSchema),
      })
      .passthrough()
      .nullable()
      .optional(),
    status: rivalsBackfillStatusSchema,
    summary: z
      .object({
        failedSeasonCount: z.number(),
        failedSeasons: z.array(z.number()),
        firstSeason: nullableNumberSchema,
        lastSeason: nullableNumberSchema,
        losses: z.number(),
        seasonsScanned: z.number(),
        seasonsWithGames: z.number(),
        totalCompletedGames: z.number(),
        totalOpponents: z.number(),
        tvGames: z.number(),
        wins: z.number(),
      })
      .passthrough(),
    syncedAt: nullableStringSchema,
    team: z
      .object({
        shortName: nullableStringSchema,
        teamId: nullableStringSchema,
        teamName: nullableStringSchema,
      })
      .passthrough(),
    warning: nullableStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

type SharedWorkspaceSectionKey =
  | "arena"
  | "lineupHelper"
  | "leagueIntel"
  | "playerLab";

export const workspaceQueryKeys = {
  accessibleMatches: (input?: {
    season?: number | null;
    teamId?: string | null;
  }) =>
    [
      "workspace",
      "accessibleMatches",
      input?.teamId ?? null,
      input?.season ?? null,
    ] as const,
  billing: ["billing", "summary"] as const,
  billingPayments: (input?: { limit?: number; nextToken?: string | null }) =>
    [
      "billing",
      "payments",
      input?.limit ?? 20,
      input?.nextToken ?? null,
    ] as const,
  boxscore: (matchId: string, preferLive = false) =>
    [
      "workspace",
      "boxscore",
      matchId,
      preferLive ? "prefer-live" : "cache-first",
    ] as const,
  connection: ["workspace", "connection"] as const,
  currentPrediction: ["workspace", "prediction", "current"] as const,
  arena: ["workspace", "arena"] as const,
  highlights: (input: { onlyOutcomeChange: boolean; perspective: string }) =>
    [
      "workspace",
      "highlights",
      input.perspective,
      input.onlyOutcomeChange ? "outcome-only" : "all",
    ] as const,
  home: ["workspace", "home"] as const,
  leagueHistoryAudit: (input?: {
    includeLiveComparison?: boolean | null;
    leagueId?: string | null;
  }) =>
    [
      "workspace",
      "leagueHistoryAudit",
      input?.leagueId ?? "default",
      input?.includeLiveComparison ? "live" : "cached",
    ] as const,
  leagueHistory: (leagueId: string | null | undefined) =>
    ["workspace", "leagueHistory", leagueId ?? "default"] as const,
  leagueIntelAutoRefresh: ["workspace", "leagueIntel", "autoRefresh"] as const,
  leagueIntel: (input?: { leagueId?: string | null }) =>
    ["workspace", "leagueIntel", input?.leagueId ?? "connected"] as const,
  leagueSeasonSimulation: (input?: { leagueId?: string | null }) =>
    [
      "workspace",
      "leagueSeasonSimulation",
      input?.leagueId ?? "connected",
    ] as const,
  lineupHelper: ["workspace", "lineupHelper"] as const,
  lineupHelperEvaluation: (input: {
    assignments: readonly unknown[];
    context: unknown;
    roster: readonly unknown[];
  }) => ["workspace", "lineupHelper", "evaluation", input] as const,
  nextGameRecommendation: (input: {
    forecastJobId: string;
    input: NextGameRecommendationInput;
    matchId: string;
    opponentTeamId: string;
  }) =>
    [
      "workspace",
      "recommendation",
      input.matchId,
      input.opponentTeamId,
      input.forecastJobId,
      ...input.input.excludedPlayerIds,
      input.input.enthusiasm,
      input.input.defensiveSwitch.pg,
      input.input.defensiveSwitch.sg,
      input.input.defensiveSwitch.sf,
      input.input.defensiveSwitch.pf,
      input.input.defensiveSwitch.c,
    ] as const,
  nextGamePlannerDetail: (artifactKey: string | null | undefined) =>
    ["workspace", "recommendation", "planner", artifactKey ?? "none"] as const,
  opponentForecast: (teamId: string | null | undefined) =>
    ["workspace", "forecast", teamId ?? "none"] as const,
  operationsActivity: (limit = 8) =>
    ["workspace", "operations", limit] as const,
  playerLab: ["workspace", "playerLab"] as const,
  manualSalaryEstimate: (input: { skills: SalaryCalculatorSkillsInput }) =>
    ["workspace", "salaryCalculator", "estimate", input] as const,
  predictionMatrix: (request: PredictionDraft) =>
    ["workspace", "prediction", "matrix", request] as const,
  playerTrend: (playerId: string) =>
    ["workspace", "playerTrend", playerId] as const,
  recapHistory: (input?: { limit?: number; nextToken?: string | null }) =>
    [
      "workspace",
      "recaps",
      input?.limit ?? 8,
      input?.nextToken ?? null,
    ] as const,
  rivals: (args?: {
    competitionKeys?: readonly string[] | null;
    endSeason?: number | null;
    outcomes?: readonly string[] | null;
    selectedOpponentId?: string | null;
    startSeason?: number | null;
    tvScopes?: readonly string[] | null;
    venues?: readonly string[] | null;
  }) =>
    [
      "workspace",
      "rivals",
      args?.competitionKeys ?? null,
      args?.venues ?? null,
      args?.outcomes ?? null,
      args?.tvScopes ?? null,
      args?.startSeason ?? null,
      args?.endSeason ?? null,
      args?.selectedOpponentId ?? null,
    ] as const,
  root: ["workspace"] as const,
  salaryCalculatorSeed: (playerId: string) =>
    ["workspace", "salaryCalculator", "seed", playerId] as const,
  salaryProjection: (playerId: string) =>
    ["workspace", "salaryProjection", playerId] as const,
  scoutSchedule: (args: {
    competitionKeys?: readonly string[] | null;
    season?: number | null;
    teamId?: string | null;
  }) =>
    [
      "workspace",
      "scout",
      "schedule",
      args.teamId ?? "default",
      args.season ?? "latest",
      ...(args.competitionKeys ?? []).slice().sort(),
    ] as const,
  scoutSummary: (teamId: string | null | undefined) =>
    ["workspace", "scout", "summary", teamId ?? "default"] as const,
} as const;

function normalizeCompetitionKeys(
  competitionKeys?: readonly string[] | null,
): string[] | undefined {
  const normalized = (competitionKeys ?? []).filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  return normalized.length ? [...normalized].sort() : undefined;
}

function readAmplifyDataOrThrow<T>(
  response: {
    data?: unknown;
    errors?: ReadonlyArray<{ message?: string }> | null;
  },
  schema: z.ZodType<T>,
  emptyMessage: string,
): T {
  if (response.errors?.length) {
    throw new Error(formatAmplifyErrors([...response.errors]));
  }
  if (response.data == null) {
    throw new Error(emptyMessage);
  }

  return parseSchemaOrThrow(schema, response.data);
}

function readAmplifyNullableDataOrThrow<T>(
  response: {
    data?: unknown;
    errors?: ReadonlyArray<{ message?: string }> | null;
  },
  schema: z.ZodType<T>,
): T | null {
  if (response.errors?.length) {
    throw new Error(formatAmplifyErrors([...response.errors]));
  }
  if (response.data == null) {
    return null;
  }

  return parseSchemaOrThrow(schema, response.data);
}

async function readInternalRouteDataOrThrow<T>(
  response: Response,
  schema: z.ZodType<T>,
  emptyMessage: string,
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown;
    errors?: ReadonlyArray<{ message?: string }> | null;
  } | null;

  if (!response.ok || payload?.errors?.length) {
    throw new Error(payload?.errors?.[0]?.message ?? emptyMessage);
  }
  if (payload?.data == null) {
    throw new Error(emptyMessage);
  }

  return parseSchemaOrThrow(schema, payload.data);
}

function parseSchemaOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          if (issue.code === "unrecognized_keys") {
            const label = path || "value";
            return `${label} contains unsupported key(s): ${issue.keys.join(", ")}`;
          }
          return `${path || "value"}: ${issue.message}`;
        })
        .join("; ");
      throw new Error(details);
    }

    throw error;
  }
}

function toRecommendationInputArg(
  input: NextGameRecommendationInput,
): NonNullable<Schema["submitNextGameRecommendationJob"]["args"]>["input"] {
  return {
    excludedPlayerIds: [...input.excludedPlayerIds],
    enthusiasm: input.enthusiasm,
    defensiveSwitch: {
      pg: input.defensiveSwitch.pg as NonNullable<
        Schema["submitNextGameRecommendationJob"]["args"]
      >["input"]["defensiveSwitch"]["pg"],
      sg: input.defensiveSwitch.sg as NonNullable<
        Schema["submitNextGameRecommendationJob"]["args"]
      >["input"]["defensiveSwitch"]["sg"],
      sf: input.defensiveSwitch.sf as NonNullable<
        Schema["submitNextGameRecommendationJob"]["args"]
      >["input"]["defensiveSwitch"]["sf"],
      pf: input.defensiveSwitch.pf as NonNullable<
        Schema["submitNextGameRecommendationJob"]["args"]
      >["input"]["defensiveSwitch"]["pf"],
      c: input.defensiveSwitch.c as NonNullable<
        Schema["submitNextGameRecommendationJob"]["args"]
      >["input"]["defensiveSwitch"]["c"],
    },
  };
}

export async function fetchConnectionRecord(): Promise<BbConnectionRecord | null> {
  const response = await client.reads.getCurrentBbConnection();
  return readAmplifyNullableDataOrThrow(
    response,
    connectionResultSchema,
  ) as BbConnectionRecord | null;
}

export async function fetchBillingSummaryQuery(): Promise<BillingSummary> {
  const response = await client.queries.getBillingSummary();
  return readAmplifyDataOrThrow(
    response,
    billingSummarySchema,
    "Unable to load billing status.",
  ) as BillingSummary;
}

export async function fetchBillingPaymentsQuery(input?: {
  limit?: number;
  nextToken?: string | null;
}): Promise<BillingPaymentsPage> {
  const response = await client.queries.listMyBillingPayments(
    input
      ? {
          ...(input.limit ? { limit: input.limit } : {}),
          ...(input.nextToken ? { nextToken: input.nextToken } : {}),
        }
      : undefined,
  );
  return readAmplifyDataOrThrow(
    response,
    billingPaymentsPageSchema,
    "Unable to load billing payments.",
  ) as BillingPaymentsPage;
}

export async function fetchHomeWorkspaceQuery(args?: {
  force?: boolean;
}): Promise<HomeWorkspacePayload> {
  const response = args?.force
    ? await client.mutations.refreshWorkspace()
    : await client.queries.getHomeWorkspace();

  return readAmplifyDataOrThrow(
    response,
    homeWorkspaceSchema,
    "Unable to load your club workspace.",
  ) as HomeWorkspacePayload;
}

export async function fetchLineupHelperWorkspaceQuery(args?: {
  force?: boolean;
}): Promise<LineupHelperWorkspaceRecord | null> {
  const response = await client.queries.getLineupHelperWorkspace(
    args?.force ? { force: true } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    lineupHelperWorkspaceSchema,
  ) as LineupHelperWorkspaceRecord | null;
}

export async function fetchLineupHelperEvaluationQuery(input: {
  assignments: unknown[];
  context: unknown;
  roster: unknown[];
}): Promise<LineupHelperEvaluationRecord> {
  const response = await client.queries.evaluateLineupHelper({
    assignments:
      input.assignments as LineupHelperWorkspaceRecord["defaultAssignments"],
    context: input.context as LineupHelperWorkspaceRecord["defaultContext"],
    roster: input.roster as LineupHelperWorkspaceRecord["roster"],
  });

  return readAmplifyDataOrThrow(
    response,
    lineupHelperEvaluationSchema,
    "Unable to evaluate the lineup helper request.",
  ) as LineupHelperEvaluationRecord;
}

export async function optimizeLineupHelperQuery(input: {
  algorithm?: string | null;
  context: unknown;
  roster: unknown[];
}): Promise<LineupHelperEvaluationRecord> {
  const response = await client.queries.optimizeLineupHelper({
    ...(input.algorithm ? { algorithm: input.algorithm as never } : {}),
    context: input.context as LineupHelperWorkspaceRecord["defaultContext"],
    roster: input.roster as LineupHelperWorkspaceRecord["roster"],
  });

  return readAmplifyDataOrThrow(
    response,
    lineupHelperEvaluationSchema,
    "Unable to optimize the lineup helper request.",
  ) as LineupHelperEvaluationRecord;
}

export async function fetchLeagueIntelQuery(args?: {
  force?: boolean;
  leagueId?: string | null;
}): Promise<LeagueIntelPayload | null> {
  const leagueId = args?.leagueId?.trim() ?? "";
  const input = {
    ...(args?.force ? { force: true } : {}),
    ...(leagueId ? { leagueId } : {}),
  };
  const response = await client.queries.getLeagueIntel(
    Object.keys(input).length ? input : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    leagueIntelSchema,
  ) as LeagueIntelPayload | null;
}

export async function fetchArenaWorkspaceQuery(args?: {
  force?: boolean;
}): Promise<ArenaWorkspacePayload | null> {
  const response = await client.queries.getArenaWorkspace(
    args?.force ? { force: true } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    arenaWorkspaceSchema,
  ) as ArenaWorkspacePayload | null;
}

export async function fetchPlayerLabQuery(args?: {
  force?: boolean;
}): Promise<PlayerLabPayload | null> {
  const response = await client.queries.getPlayerLab(
    args?.force ? { force: true } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    playerLabSchema,
  ) as PlayerLabPayload | null;
}

export async function fetchPlayerTrendQuery(args: {
  playerId: string;
}): Promise<PlayerTrendPayload | null> {
  const response = await client.queries.getPlayerTrend({
    playerId: args.playerId,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    playerTrendSchema,
  ) as PlayerTrendPayload | null;
}

export async function fetchSalaryProjectionQuery(args: {
  playerId: string;
}): Promise<SalaryProjection | null> {
  const response = await client.queries.getSalaryProjection({
    playerId: args.playerId,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    salaryProjectionSchema,
  ) as SalaryProjection | null;
}

export async function fetchSalaryCalculatorSeedQuery(args: {
  playerId: string;
}): Promise<SalaryCalculatorSeed | null> {
  const response = await client.queries.getSalaryCalculatorSeed({
    playerId: args.playerId,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    salaryCalculatorSeedSchema,
  ) as SalaryCalculatorSeed | null;
}

export async function fetchManualSalaryEstimateQuery(args: {
  input: {
    skills: SalaryCalculatorSkillsInput;
  };
}): Promise<ManualSalaryEstimate | null> {
  const response = await client.queries.getManualSalaryEstimate({
    input: args.input,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    manualSalaryEstimateSchema,
  ) as ManualSalaryEstimate | null;
}

export async function fetchScoutTeamSummaryQuery(args?: {
  force?: boolean;
  teamId?: string | null;
}): Promise<ScoutTeamSummaryPayload | null> {
  const response = await client.queries.getScoutTeamSummary({
    ...(args?.force ? { force: true } : {}),
    ...(args?.teamId ? { teamId: args.teamId } : {}),
  });

  return readAmplifyNullableDataOrThrow(
    response,
    scoutWorkspaceSchema,
  ) as ScoutTeamSummaryPayload | null;
}

export async function fetchScoutScheduleQuery(args: {
  competitionKeys?: readonly string[] | null;
  force?: boolean;
  season?: number | null;
  teamId?: string | null;
}): Promise<ScoutSchedulePayload | null> {
  const competitionKeys = normalizeCompetitionKeys(args.competitionKeys);
  const response = await client.queries.getScoutSchedule({
    ...(competitionKeys ? { competitionKeys } : {}),
    ...(args.force ? { force: true } : {}),
    ...(typeof args.season === "number" ? { season: args.season } : {}),
    ...(args.teamId ? { teamId: args.teamId } : {}),
  });

  return readAmplifyNullableDataOrThrow(
    response,
    scoutScheduleSchema,
  ) as ScoutSchedulePayload | null;
}

export async function fetchLatestOpponentForecastQuery(args: {
  teamId: string;
}): Promise<OpponentForecastSnapshot | null> {
  const response = await client.queries.getLatestOpponentForecast({
    teamId: args.teamId,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    opponentForecastSchema,
  ) as OpponentForecastSnapshot | null;
}

export async function fetchLatestLeagueSeasonSimulationQuery(args?: {
  leagueId?: string | null;
}): Promise<LeagueSeasonSimulationSnapshot | null> {
  const leagueId = args?.leagueId?.trim() ?? "";
  const response = await client.queries.getLatestLeagueSeasonSimulation(
    leagueId ? { leagueId } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    leagueSeasonSimulationSchema,
  ) as LeagueSeasonSimulationSnapshot | null;
}

export async function fetchLatestNextGameRecommendationQuery(args: {
  forecastJobId: string;
  input: NextGameRecommendationInput;
  matchId: string;
  opponentTeamId: string;
}): Promise<NextGameRecommendationSnapshot | null> {
  const response = await client.queries.getLatestNextGameRecommendation({
    forecastJobId: args.forecastJobId,
    input: toRecommendationInputArg(args.input),
    matchId: args.matchId,
    opponentTeamId: args.opponentTeamId,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    nextGameRecommendationSchema,
  ) as NextGameRecommendationSnapshot | null;
}

export async function fetchNextGamePlannerDetailQuery(args: {
  artifactKey: string;
}): Promise<NextGamePlannerDetailPayload | null> {
  const response = await client.queries.getNextGamePlannerDetail({
    artifactKey: args.artifactKey,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    nextGamePlannerDetailSchema,
  ) as NextGamePlannerDetailPayload | null;
}

export async function fetchAccessibleMatchesQuery(args?: {
  season?: number | null;
  teamId?: string | null;
}): Promise<AccessibleMatchSummary[]> {
  const items: AccessibleMatchSummary[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.queries.listAccessibleMatches({
      ...(typeof args?.season === "number" ? { season: args.season } : {}),
      ...(args?.teamId ? { teamId: args.teamId } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const page = readAmplifyDataOrThrow(
      response,
      accessibleMatchListSchema,
      "Unable to load accessible matches.",
    );
    items.push(
      ...page.items.map((item) => ({
        ingestStatus: item.ingestStatus,
        matchId: item.matchId,
        opponentScore: item.opponentScore ?? null,
        opponentTeamId: item.opponentTeamId ?? null,
        opponentTeamName: item.opponentTeamName ?? null,
        outcome: item.outcome ?? null,
        season: item.season ?? null,
        startTime: item.startTime ?? null,
        teamId: item.teamId,
        teamScore: item.teamScore ?? null,
        type: item.type ?? null,
      })),
    );
    cursor = page.nextCursor ?? null;
  } while (cursor);

  return items;
}

export async function fetchPredictionMatrixQuery(args: {
  request: PredictionDraft;
}): Promise<PredictionMatrixResult> {
  const response = await client.queries.evaluatePredictionMatrix({
    request: toPredictionMatrixRequestInput(args.request),
  });
  return readAmplifyDataOrThrow(
    response,
    predictionMatrixResultSchema,
    "Unable to evaluate the matchup matrix.",
  ) as PredictionMatrixResult;
}

function toPredictionMatrixRequestInput(draft: PredictionDraft) {
  return {
    ...(draft.modelKey ? { modelKey: draft.modelKey } : {}),
    teamA: toPredictionMatrixSideInput(draft.teamA),
    teamB: toPredictionMatrixSideInput(draft.teamB),
    venue: draft.venue,
  };
}

function toPredictionMatrixSideInput(side: PredictionSideInput) {
  return {
    defense: side.defense,
    effortChoice: side.effortChoice,
    offense: side.offense,
    ratings: {
      insideDefense: side.ratings.insideDefense,
      insideScoring: side.ratings.insideScoring,
      offensiveFlow: side.ratings.offensiveFlow,
      outsideDefense: side.ratings.outsideDefense,
      outsideScoring: side.ratings.outsideScoring,
      rebounding: side.ratings.rebounding,
    },
    teamId: side.teamId,
    teamName: side.teamName,
  };
}

export async function fetchCurrentPredictionQuery(): Promise<CurrentPredictionPreview | null> {
  const response = await client.reads.getCurrentPrediction();
  return readAmplifyNullableDataOrThrow(
    response,
    currentPredictionPreviewSchema,
  ) as CurrentPredictionPreview | null;
}

export async function fetchOperationsActivityQuery(args?: {
  limit?: number;
}): Promise<OperationsActivity> {
  const response = await client.reads.getOperationsActivity(args);
  return readAmplifyDataOrThrow(
    response,
    operationsActivitySchema,
    "Unable to load recent activity.",
  ) as OperationsActivity;
}

export async function fetchRecapHistoryQuery(args?: {
  limit?: number;
  nextToken?: string | null;
}): Promise<{ items: RecapHistoryRecord[]; nextToken: string | null }> {
  const response = await client.reads.getRecapHistory(args);
  return readAmplifyDataOrThrow(
    response,
    paginatedRecapHistorySchema,
    "Unable to load recap history.",
  ) as { items: RecapHistoryRecord[]; nextToken: string | null };
}

export async function fetchLeagueHistoryQuery(args?: {
  leagueId?: string | null;
}): Promise<LeagueHistoryPayload | null> {
  const response = await client.queries.getLeagueHistory(
    args?.leagueId ? { leagueId: args.leagueId } : undefined,
  );

  return readAmplifyNullableDataOrThrow(
    response,
    leagueHistorySchema,
  ) as LeagueHistoryPayload | null;
}

export async function fetchLeagueHistoryAuditQuery(args?: {
  includeLiveComparison?: boolean | null;
  leagueId?: string | null;
}): Promise<LeagueHistoryAuditPayload | null> {
  const input =
    args && (args.leagueId || args.includeLiveComparison)
      ? {
          ...(args.includeLiveComparison
            ? { includeLiveComparison: true }
            : {}),
          ...(args.leagueId ? { leagueId: args.leagueId } : {}),
        }
      : undefined;
  const response = await (
    client.queries as typeof client.queries & {
      getLeagueHistoryAudit: typeof client.queries.getLeagueHistory;
    }
  ).getLeagueHistoryAudit(input);

  return readAmplifyNullableDataOrThrow(
    response,
    leagueHistoryAuditSchema,
  ) as LeagueHistoryAuditPayload | null;
}

export async function fetchTeamHighlightsQuery(args: {
  cursor?: string | null;
  onlyOutcomeChange: boolean;
  perspective: string;
}): Promise<TeamHighlightsPayload | null> {
  const response = await client.queries.getMyTeamHighlights({
    ...(args.cursor ? { cursor: args.cursor } : {}),
    onlyOutcomeChange: args.onlyOutcomeChange,
    perspective: args.perspective as never,
  });

  return readAmplifyNullableDataOrThrow(
    response,
    teamHighlightsSchema,
  ) as TeamHighlightsPayload | null;
}

export async function fetchMatchBoxscoreQuery(args: {
  matchId: string;
  preferLive?: boolean;
}): Promise<MatchBoxscorePayload | null> {
  const response = await client.queries.getMatchBoxscoreDetails({
    matchId: args.matchId,
    ...(args.preferLive ? { preferLive: true } : {}),
  });

  return readAmplifyNullableDataOrThrow(
    response,
    matchBoxscoreSchema,
  ) as MatchBoxscorePayload | null;
}

export async function fetchRivalsWorkspaceQuery(args?: {
  competitionKeys?: readonly string[] | null;
  endSeason?: number | null;
  outcomes?: readonly string[] | null;
  selectedOpponentId?: string | null;
  startSeason?: number | null;
  tvScopes?: readonly string[] | null;
  venues?: readonly string[] | null;
}): Promise<RivalsWorkspacePayload | null> {
  const normalizeStringArray = (value?: readonly string[] | null) =>
    Array.isArray(value) ? [...value] : undefined;

  const response = await client.queries.getRivalsWorkspace(
    args
      ? {
          ...(normalizeStringArray(args.competitionKeys)
            ? { competitionKeys: normalizeStringArray(args.competitionKeys) }
            : {}),
          ...(args.endSeason !== undefined
            ? { endSeason: args.endSeason }
            : {}),
          ...(normalizeStringArray(args.outcomes)
            ? { outcomes: normalizeStringArray(args.outcomes) }
            : {}),
          ...(args.selectedOpponentId !== undefined
            ? { selectedOpponentId: args.selectedOpponentId }
            : {}),
          ...(args.startSeason !== undefined
            ? { startSeason: args.startSeason }
            : {}),
          ...(normalizeStringArray(args.tvScopes)
            ? { tvScopes: normalizeStringArray(args.tvScopes) }
            : {}),
          ...(normalizeStringArray(args.venues)
            ? { venues: normalizeStringArray(args.venues) }
            : {}),
        }
      : undefined,
  );
  return readAmplifyNullableDataOrThrow(
    response,
    rivalsWorkspaceSchema,
  ) as RivalsWorkspacePayload | null;
}

export async function submitPredictionJobMutation(input: {
  request: PredictionSubmissionRequest;
}): Promise<SubmitPredictionJobResult> {
  const response = await client.mutations.submitPredictionJob({
    request: input.request,
  });
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        jobId: z.string(),
      })
      .passthrough(),
    "Unable to submit the prediction job.",
  ) as SubmitPredictionJobResult;
}

export async function connectBbAccountMutation(
  input: ConnectBbAccountInput,
): Promise<ConnectBbAccountResult> {
  const response = await client.mutations.connectBbAccount(input);
  return readAmplifyDataOrThrow(
    response,
    connectionResultSchema,
    "Unable to connect the BuzzerBeater account.",
  ) as ConnectBbAccountResult;
}

export async function disconnectBbAccountMutation(): Promise<DisconnectBbAccountResult> {
  const response = await client.mutations.disconnectBbAccount();
  return readAmplifyDataOrThrow(
    response,
    connectionResultSchema,
    "Unable to disconnect the BuzzerBeater account.",
  ) as DisconnectBbAccountResult;
}

export async function setBbLeagueTimeZoneMutation(input: {
  leagueTimeZone: string;
}): Promise<SetBbLeagueTimeZoneResult> {
  const response = await client.mutations.setBbLeagueTimeZone(input);
  return readAmplifyDataOrThrow(
    response,
    connectionResultSchema,
    "Unable to update the league time zone.",
  ) as SetBbLeagueTimeZoneResult;
}

export async function submitProductFeedbackMutation(
  input: SubmitProductFeedbackInput,
): Promise<SubmitProductFeedbackResult> {
  const response = await client.mutations.submitProductFeedback(input);
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        id: z.string(),
        notified: z.boolean(),
        submittedAt: z.string(),
      })
      .passthrough(),
    "Unable to send your feedback.",
  ) as SubmitProductFeedbackResult;
}

export async function submitOpponentForecastJobMutation(input: {
  teamId: string;
}): Promise<SubmitOpponentForecastJobResult> {
  const response = await client.mutations.submitOpponentForecastJob({
    teamId: input.teamId,
  });
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        jobId: z.string(),
      })
      .passthrough(),
    "Unable to submit the opponent forecast job.",
  ) as SubmitOpponentForecastJobResult;
}

export async function submitLeagueSeasonSimulationJobMutation(args?: {
  leagueId?: string | null;
}): Promise<SubmitLeagueSeasonSimulationJobResult> {
  const leagueId = args?.leagueId?.trim() ?? "";
  const response = await client.mutations.submitLeagueSeasonSimulationJob(
    leagueId ? { leagueId } : undefined,
  );
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        jobId: z.string(),
      })
      .passthrough(),
    "Unable to submit the league season simulation job.",
  ) as SubmitLeagueSeasonSimulationJobResult;
}

export async function repairOwnerRosterDataMutation(): Promise<RepairOwnerRosterDataResult> {
  const response = await client.mutations.repairOwnerRosterData();
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        completedAt: z.string(),
        repairedPlayerCount: z.number(),
      })
      .passthrough(),
    "Unable to repair owner roster data.",
  ) as RepairOwnerRosterDataResult;
}

export async function submitNextGameRecommendationJobMutation(input: {
  input: NextGameRecommendationInput;
}): Promise<SubmitNextGameRecommendationJobResult> {
  const response = await client.mutations.submitNextGameRecommendationJob({
    input: toRecommendationInputArg(input.input),
  });
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        jobId: z.string(),
      })
      .passthrough(),
    "Unable to submit the next-game recommendation job.",
  ) as SubmitNextGameRecommendationJobResult;
}

export async function submitMyTeamHighlightsScanMutation(): Promise<SubmitMyTeamHighlightsScanResult> {
  const response = await client.mutations.submitMyTeamHighlightsScan();
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        queued: z.boolean(),
        requestedAt: z.string(),
        status: z.string(),
        teamId: z.string(),
        teamName: nullableStringSchema,
      })
      .passthrough(),
    "Unable to submit the team highlights scan.",
  ) as SubmitMyTeamHighlightsScanResult;
}

export async function clearMyTeamHighlightsDataMutation(): Promise<void> {
  const response = await client.mutations.clearMyTeamHighlightsData();
  if (response.errors?.length) {
    throw new Error(formatAmplifyErrors([...response.errors]));
  }
}

export async function submitLeagueHistoryBackfillMutation(args?: {
  leagueId?: string | null;
  refreshMode?: "MISSING_ONLY" | "REFRESH_ALL_HISTORICAL" | null;
}): Promise<SubmitLeagueHistoryBackfillResult> {
  const input =
    args && (args.leagueId || args.refreshMode)
      ? {
          ...(args.leagueId ? { leagueId: args.leagueId } : {}),
          ...(args.refreshMode ? { refreshMode: args.refreshMode } : {}),
        }
      : undefined;
  const response = await client.mutations.submitLeagueHistoryBackfill(input);
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        leagueId: z.string(),
        leagueName: nullableStringSchema,
        queued: z.boolean(),
        requestedAt: z.string(),
        status: z.string(),
      })
      .passthrough(),
    "Unable to submit the league history backfill.",
  ) as SubmitLeagueHistoryBackfillResult;
}

export async function submitRivalsBackfillMutation(): Promise<SubmitRivalsBackfillResult> {
  const response = await client.mutations.submitRivalsBackfill();
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        queued: z.boolean(),
        requestedAt: z.string(),
        status: z.string(),
        teamId: z.string(),
        teamName: nullableStringSchema,
      })
      .passthrough(),
    "Unable to refresh rivals history.",
  ) as SubmitRivalsBackfillResult;
}

export async function submitGameDayRecapMutation(input: {
  approach?: RecapGenerationApproach;
  gameDate: string;
  interviewIntensity?: RecapInterviewIntensity;
  leagueId: string;
  leagueTimeZone: string;
  modelJudgeEnabled?: boolean;
  qualityTier?: "premium" | "standard";
}): Promise<SubmitGameDayRecapResult> {
  const response = await client.mutations.submitGameDayRecap(input);
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        targetKey: z.string(),
      })
      .passthrough(),
    "Unable to submit the league-date recap request.",
  ) as SubmitGameDayRecapResult;
}

export async function submitLeagueGameDayRecapMutation(input: {
  approach?: RecapGenerationApproach;
  gameDayNumber: number;
  interviewIntensity?: RecapInterviewIntensity;
  leagueId: string;
  modelJudgeEnabled?: boolean;
  qualityTier?: "premium" | "standard";
  season?: number;
}): Promise<SubmitLeagueGameDayRecapResult> {
  const response = await client.mutations.submitLeagueGameDayRecap(input);
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        targetKey: z.string(),
      })
      .passthrough(),
    "Unable to submit the league game-day recap request.",
  ) as SubmitLeagueGameDayRecapResult;
}

export async function submitLeagueGameDayPerformancesMutation(input: {
  gameDayNumber: number;
  leagueId: string;
  season?: number;
}): Promise<SubmitLeagueGameDayPerformancesResult> {
  const response = await client.mutations.submitLeagueGameDayPerformances(input);
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        targetKey: z.string(),
      })
      .passthrough(),
    "Unable to submit the league game-day performances request.",
  ) as SubmitLeagueGameDayPerformancesResult;
}

export async function submitSingleGameSummaryMutation(input: {
  approach?: RecapGenerationApproach;
  interviewIntensity?: RecapInterviewIntensity;
  loserInterviewPersonalityType?: InterviewPersonalityType;
  matchId: string;
  modelJudgeEnabled?: boolean;
  qualityTier?: "premium" | "standard";
  winnerInterviewPersonalityType?: InterviewPersonalityType;
}): Promise<SubmitSingleGameSummaryResult> {
  const response = await client.mutations.submitSingleGameSummary(input);
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        executionArn: nullableStringSchema,
        targetKey: z.string(),
      })
      .passthrough(),
    "Unable to submit the single-game recap request.",
  ) as SubmitSingleGameSummaryResult;
}

export async function setTrackedPlayerInterviewPersonalityMutation(input: {
  personalityType?: string | null;
  playerId: string;
}): Promise<SetTrackedPlayerInterviewPersonalityResult> {
  const response = await client.mutations.setTrackedPlayerInterviewPersonality({
    playerId: input.playerId,
    ...(input.personalityType !== undefined
      ? { personalityType: input.personalityType }
      : {}),
  });
  return readAmplifyDataOrThrow(
    response,
    z
      .object({
        interviewPersonalitySource: z.string(),
        interviewPersonalityType: z.string(),
        playerId: z.string(),
      })
      .passthrough(),
    "Unable to save the interview voice.",
  ) as SetTrackedPlayerInterviewPersonalityResult;
}

export async function createBillingCheckoutUrlMutation(returnPath?: string) {
  const response = await client.mutations.createBillingCheckoutSession(
    returnPath ? { returnPath } : undefined,
  );
  return readAmplifyDataOrThrow(
    response,
    z.object({ url: z.string() }).passthrough(),
    "Unable to start checkout.",
  ).url;
}

export async function createBillingLifetimeCheckoutUrlMutation(
  returnPath?: string,
) {
  const response = await client.mutations.createBillingLifetimeCheckoutSession(
    returnPath ? { returnPath } : undefined,
  );
  return readAmplifyDataOrThrow(
    response,
    z.object({ url: z.string() }).passthrough(),
    "Unable to start lifetime checkout.",
  ).url;
}

export async function createBillingPortalUrlMutation(returnPath?: string) {
  const response = await client.mutations.createBillingPortalSession(
    returnPath ? { returnPath } : undefined,
  );
  return readAmplifyDataOrThrow(
    response,
    z.object({ url: z.string() }).passthrough(),
    "Unable to open the billing portal.",
  ).url;
}

export async function saveThemePreferenceMutation(
  themeId: ThemeId,
): Promise<{ themeId: ThemeId }> {
  const response = await fetch("/api/app/theme", {
    body: JSON.stringify({ themeId }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "PUT",
  });

  const payload = await readInternalRouteDataOrThrow(
    response,
    z.object({ themeId: themeIdSchema }).passthrough(),
    "Unable to save your theme preference.",
  );
  return payload as { themeId: ThemeId };
}

export function connectionQueryOptions() {
  return queryOptions({
    queryFn: fetchConnectionRecord,
    queryKey: workspaceQueryKeys.connection,
  });
}

export function billingSummaryQueryOptions() {
  return queryOptions({
    queryFn: fetchBillingSummaryQuery,
    queryKey: workspaceQueryKeys.billing,
  });
}

export function billingPaymentsQueryOptions(input?: {
  limit?: number;
  nextToken?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchBillingPaymentsQuery(input),
    queryKey: workspaceQueryKeys.billingPayments(input),
  });
}

export function homeWorkspaceQueryOptions() {
  return queryOptions({
    queryFn: () => fetchHomeWorkspaceQuery(),
    queryKey: workspaceQueryKeys.home,
  });
}

export function lineupHelperWorkspaceQueryOptions() {
  return queryOptions({
    queryFn: () => fetchLineupHelperWorkspaceQuery(),
    queryKey: workspaceQueryKeys.lineupHelper,
  });
}

export function lineupHelperEvaluationQueryOptions(input: {
  assignments: unknown[];
  context: unknown;
  roster: unknown[];
}) {
  return queryOptions({
    queryFn: () => fetchLineupHelperEvaluationQuery(input),
    queryKey: workspaceQueryKeys.lineupHelperEvaluation(input),
  });
}

export function leagueIntelQueryOptions(args?: { leagueId?: string | null }) {
  return queryOptions({
    queryFn: () => fetchLeagueIntelQuery(args),
    queryKey: workspaceQueryKeys.leagueIntel(args),
  });
}

export function arenaWorkspaceQueryOptions() {
  return queryOptions({
    queryFn: () => fetchArenaWorkspaceQuery(),
    queryKey: workspaceQueryKeys.arena,
  });
}

export function playerLabQueryOptions() {
  return queryOptions({
    queryFn: () => fetchPlayerLabQuery(),
    queryKey: workspaceQueryKeys.playerLab,
  });
}

export function playerTrendQueryOptions(args: { playerId: string }) {
  return queryOptions({
    queryFn: () => fetchPlayerTrendQuery(args),
    queryKey: workspaceQueryKeys.playerTrend(args.playerId),
  });
}

export function salaryProjectionQueryOptions(args: { playerId: string }) {
  return queryOptions({
    queryFn: () => fetchSalaryProjectionQuery(args),
    queryKey: workspaceQueryKeys.salaryProjection(args.playerId),
  });
}

export function salaryCalculatorSeedQueryOptions(args: { playerId: string }) {
  return queryOptions({
    queryFn: () => fetchSalaryCalculatorSeedQuery(args),
    queryKey: workspaceQueryKeys.salaryCalculatorSeed(args.playerId),
  });
}

export function manualSalaryEstimateQueryOptions(args: {
  input: {
    skills: SalaryCalculatorSkillsInput;
  };
}) {
  return queryOptions({
    queryFn: () => fetchManualSalaryEstimateQuery(args),
    queryKey: workspaceQueryKeys.manualSalaryEstimate(args.input),
  });
}

export function scoutTeamSummaryQueryOptions(args?: {
  teamId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchScoutTeamSummaryQuery(args),
    queryKey: workspaceQueryKeys.scoutSummary(args?.teamId),
  });
}

export function scoutScheduleQueryOptions(args: {
  competitionKeys?: readonly string[] | null;
  season?: number | null;
  teamId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchScoutScheduleQuery(args),
    queryKey: workspaceQueryKeys.scoutSchedule(args),
  });
}

export function opponentForecastQueryOptions(args: { teamId: string }) {
  return queryOptions({
    queryFn: () => fetchLatestOpponentForecastQuery(args),
    queryKey: workspaceQueryKeys.opponentForecast(args.teamId),
  });
}

export function leagueSeasonSimulationQueryOptions(args?: {
  leagueId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchLatestLeagueSeasonSimulationQuery(args),
    queryKey: workspaceQueryKeys.leagueSeasonSimulation(args),
  });
}

export function nextGameRecommendationQueryOptions(args: {
  forecastJobId: string;
  input: NextGameRecommendationInput;
  matchId: string;
  opponentTeamId: string;
}) {
  return queryOptions({
    queryFn: () => fetchLatestNextGameRecommendationQuery(args),
    queryKey: workspaceQueryKeys.nextGameRecommendation(args),
  });
}

export function nextGamePlannerDetailQueryOptions(args: {
  artifactKey: string;
}) {
  return queryOptions({
    queryFn: () => fetchNextGamePlannerDetailQuery(args),
    queryKey: workspaceQueryKeys.nextGamePlannerDetail(args.artifactKey),
  });
}

export function accessibleMatchesQueryOptions(args?: {
  season?: number | null;
  teamId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchAccessibleMatchesQuery(args),
    queryKey: workspaceQueryKeys.accessibleMatches(args),
  });
}

export function predictionMatrixQueryOptions(args: {
  request: PredictionDraft;
}) {
  return queryOptions({
    queryFn: () => fetchPredictionMatrixQuery(args),
    queryKey: workspaceQueryKeys.predictionMatrix(args.request),
  });
}

export function currentPredictionQueryOptions() {
  return queryOptions({
    queryFn: fetchCurrentPredictionQuery,
    queryKey: workspaceQueryKeys.currentPrediction,
  });
}

export function operationsActivityQueryOptions(args?: { limit?: number }) {
  return queryOptions({
    queryFn: () => fetchOperationsActivityQuery(args),
    queryKey: workspaceQueryKeys.operationsActivity(args?.limit),
  });
}

export function recapHistoryQueryOptions(args?: {
  limit?: number;
  nextToken?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchRecapHistoryQuery(args),
    queryKey: workspaceQueryKeys.recapHistory(args),
  });
}

export function leagueHistoryQueryOptions(args?: { leagueId?: string | null }) {
  return queryOptions({
    queryFn: () => fetchLeagueHistoryQuery(args),
    queryKey: workspaceQueryKeys.leagueHistory(args?.leagueId),
  });
}

export function leagueHistoryAuditQueryOptions(args?: {
  includeLiveComparison?: boolean | null;
  leagueId?: string | null;
}) {
  return queryOptions({
    queryFn: () => fetchLeagueHistoryAuditQuery(args),
    queryKey: workspaceQueryKeys.leagueHistoryAudit(args),
  });
}

export function teamHighlightsQueryOptions(args: {
  onlyOutcomeChange: boolean;
  perspective: string;
}) {
  return queryOptions({
    queryFn: () =>
      fetchTeamHighlightsQuery({
        onlyOutcomeChange: args.onlyOutcomeChange,
        perspective: args.perspective,
      }),
    queryKey: workspaceQueryKeys.highlights(args),
  });
}

export function boxscoreQueryOptions(args: {
  matchId: string;
  preferLive?: boolean;
}) {
  return queryOptions({
    queryFn: () => fetchMatchBoxscoreQuery(args),
    queryKey: workspaceQueryKeys.boxscore(
      args.matchId,
      args.preferLive ?? false,
    ),
  });
}

export function rivalsWorkspaceQueryOptions(args?: {
  competitionKeys?: readonly string[] | null;
  endSeason?: number | null;
  outcomes?: readonly string[] | null;
  selectedOpponentId?: string | null;
  startSeason?: number | null;
  tvScopes?: readonly string[] | null;
  venues?: readonly string[] | null;
}) {
  return queryOptions({
    queryFn: () => fetchRivalsWorkspaceQuery(args),
    queryKey: workspaceQueryKeys.rivals(args),
  });
}

export async function refreshHomeWorkspace(queryClient: QueryClient) {
  const home = await fetchHomeWorkspaceQuery({ force: true });
  queryClient.setQueryData(workspaceQueryKeys.home, home);
  return home;
}

export async function refreshLineupHelperAfterOwnerRosterRepair(
  queryClient: QueryClient,
) {
  const data = await fetchLineupHelperWorkspaceQuery();
  queryClient.setQueryData(workspaceQueryKeys.lineupHelper, data);
  return data;
}

export async function refreshSharedWorkspaceSection(
  queryClient: QueryClient,
  sectionKey: SharedWorkspaceSectionKey,
) {
  if (sectionKey === "arena") {
    const data = await fetchArenaWorkspaceQuery({ force: true });
    queryClient.setQueryData(workspaceQueryKeys.arena, data);
    return data;
  }
  if (sectionKey === "lineupHelper") {
    const data = await fetchLineupHelperWorkspaceQuery({ force: true });
    queryClient.setQueryData(workspaceQueryKeys.lineupHelper, data);
    return data;
  }
  if (sectionKey === "leagueIntel") {
    const data = await fetchLeagueIntelQuery({ force: true });
    queryClient.setQueryData(workspaceQueryKeys.leagueIntel(), data);
    return data;
  }

  const data = await fetchPlayerLabQuery({ force: true });
  queryClient.setQueryData(workspaceQueryKeys.playerLab, data);
  return data;
}

export async function refreshLeagueIntelWorkspace(queryClient: QueryClient) {
  const data = await fetchLeagueIntelQuery({ force: true });
  queryClient.setQueryData(workspaceQueryKeys.leagueIntel(), data);
  return data;
}

export async function refreshNextGameAfterConnectionUpdate(
  queryClient: QueryClient,
) {
  const home = await refreshHomeWorkspace(queryClient);
  const lineupHelper = await refreshSharedWorkspaceSection(
    queryClient,
    "lineupHelper",
  );
  const nextOpponentTeamId = home.nextMatch?.opponentTeamId ?? null;

  if (nextOpponentTeamId) {
    queryClient.removeQueries({
      exact: true,
      queryKey: workspaceQueryKeys.scoutSummary(nextOpponentTeamId),
    });
    queryClient.removeQueries({
      exact: true,
      queryKey: workspaceQueryKeys.opponentForecast(nextOpponentTeamId),
    });
  }

  queryClient.removeQueries({
    queryKey: ["workspace", "recommendation"],
  });

  return {
    home,
    lineupHelper,
  };
}

export async function refreshLeagueHistory(
  queryClient: QueryClient,
  leagueId?: string | null,
) {
  const data = await fetchLeagueHistoryQuery({ leagueId });
  queryClient.setQueryData(workspaceQueryKeys.leagueHistory(leagueId), data);
  return data;
}

export async function refreshLeagueHistoryAudit(
  queryClient: QueryClient,
  args?: {
    includeLiveComparison?: boolean | null;
    leagueId?: string | null;
  },
) {
  const data = await fetchLeagueHistoryAuditQuery(args);
  queryClient.setQueryData(workspaceQueryKeys.leagueHistoryAudit(args), data);
  return data;
}

export async function refreshHighlights(
  queryClient: QueryClient,
  input: { onlyOutcomeChange: boolean; perspective: string },
) {
  const data = await fetchTeamHighlightsQuery(input);
  queryClient.setQueryData(workspaceQueryKeys.highlights(input), data);
  return data;
}

export async function refreshCurrentPrediction(queryClient: QueryClient) {
  const data = await fetchCurrentPredictionQuery();
  queryClient.setQueryData(workspaceQueryKeys.currentPrediction, data);
  return data;
}

export async function refreshOperationsActivity(
  queryClient: QueryClient,
  limit = 8,
) {
  const data = await fetchOperationsActivityQuery({ limit });
  queryClient.setQueryData(workspaceQueryKeys.operationsActivity(limit), data);
  return data;
}

export async function refreshRivalsWorkspace(queryClient: QueryClient) {
  const data = await fetchRivalsWorkspaceQuery();
  queryClient.setQueryData(workspaceQueryKeys.rivals(), data);
  return data;
}
