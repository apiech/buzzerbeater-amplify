import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __testing as dashboardTesting } from "../app/dashboard-app";
import { __testing as lineupHelperTesting } from "../app/lineup-helper";
import { __testing as workspaceHookTesting } from "../app/dashboard/use-authenticated-workspace";
import { __testing as nextGameWizardTesting } from "../app/next-game-wizard-panel";
import { __testing as boxscorePageTesting } from "../app/workspace/boxscores/[matchId]/boxscore-page-client";

test("readPayload parses JSON string payloads from workspace handlers", () => {
  const payload = dashboardTesting.readPayload<{ team: { teamName: string } }>({
    payload: JSON.stringify({
      team: {
        teamName: "Visionaries",
      },
    }),
  } as any);

  assert.deepStrictEqual(payload, {
    team: {
      teamName: "Visionaries",
    },
  });
});

test("readPayload preserves object payloads returned by generated clients", () => {
  const payload = dashboardTesting.readPayload<{ summary: { wins: number } }>({
    payload: {
      summary: {
        wins: 10,
      },
    },
  } as any);

  assert.deepStrictEqual(payload, {
    summary: {
      wins: 10,
    },
  });
});

test("formatPlayerMeta surfaces recent starts before minutes or scoring", () => {
  assert.equal(
    dashboardTesting.formatPlayerMeta({
      fullName: "Wing Stopper",
      bestPosition: "SF",
      salary: 150000,
      ppg: 7.4,
      recentStartCount: 4,
      recentAvgMinutes: 31.4,
    } as any),
    "SF • $150,000 • 4 GS • 31.4 MPG",
  );
  assert.equal(
    dashboardTesting.formatPlayerMeta({
      fullName: "Bench Gunner",
      bestPosition: "SG",
      salary: 60000,
      ppg: 13.2,
      recentStartCount: null,
      recentAvgMinutes: null,
    } as any),
    "SG • $60,000 • 13.2 PPG",
  );
});

test("salary calculator seed values hydrate the editable form state", () => {
  assert.deepStrictEqual(
    dashboardTesting.createSalaryCalculatorFormState({
      driving: 24,
      handling: 25,
      insideDefense: 11,
      insideScoring: 9,
      jumpRange: 23,
      jumpShot: 25,
      outsideDefense: 24,
      passing: 25,
      rebounding: 8,
      shotBlocking: 4,
    }),
    {
      driving: "24",
      handling: "25",
      insideDefense: "11",
      insideScoring: "9",
      jumpRange: "23",
      jumpShot: "25",
      outsideDefense: "24",
      passing: "25",
      rebounding: "8",
      shotBlocking: "4",
    },
  );
});

test("salary calculator validation accepts values above 20 and rejects out-of-range entries", () => {
  const parsed = dashboardTesting.parseSalaryCalculatorFormState({
    driving: "24",
    handling: "25",
    insideDefense: "11",
    insideScoring: "9",
    jumpRange: "23",
    jumpShot: "25",
    outsideDefense: "24",
    passing: "25",
    rebounding: "8",
    shotBlocking: "4",
  });

  assert.deepStrictEqual(parsed.errors, {});
  assert.ok(parsed.skills);
  assert.equal(parsed.skills.jumpShot, 25);
  assert.equal(parsed.skills.handling, 25);

  const invalid = dashboardTesting.parseSalaryCalculatorFormState({
    ...dashboardTesting.createEmptySalaryCalculatorFormState(),
    jumpShot: "100",
  });

  assert.equal(
    invalid.errors.jumpShot,
    "Enter a whole number from 1 to 99.",
  );
  assert.equal(invalid.skills, null);
});

test("signed currency formatting stays readable for salary deltas", () => {
  assert.equal(dashboardTesting.formatSignedCurrencyValue(12000), "+$12,000");
  assert.equal(dashboardTesting.formatSignedCurrencyValue(-9000), "-$9,000");
  assert.equal(dashboardTesting.formatSignedCurrencyValue(0), "$0");
});

test("sortLineupHelperRoster orders numeric owner-roster columns descending", () => {
  const roster = [
    createRosterPlayer("zeta", {
      dmi: 120000,
      skills: { js: 9 },
    }),
    createRosterPlayer("alpha", {
      dmi: 250000,
      skills: { js: 14 },
    }),
    createRosterPlayer("beta", {
      dmi: 250000,
      skills: { js: 11 },
    }),
  ];

  assert.deepStrictEqual(
    dashboardTesting
      .sortLineupHelperRoster(roster as any, "dmi", "desc")
      .map((player) => player.fullName),
    ["alpha", "beta", "zeta"],
  );
  assert.deepStrictEqual(
    dashboardTesting
      .sortLineupHelperRoster(roster as any, "js", "desc")
      .map((player) => player.fullName),
    ["alpha", "beta", "zeta"],
  );
});

test("sortLineupHelperRoster keeps unavailable skill rows below players with owner snapshots", () => {
  const roster = [
    createRosterPlayer("available", {
      available: true,
      skills: { rb: 10 },
    }),
    createRosterPlayer("missing", {
      available: false,
      skills: { rb: 99 },
    }),
  ];

  assert.deepStrictEqual(
    dashboardTesting
      .sortLineupHelperRoster(roster as any, "rb", "desc")
      .map((player) => player.fullName),
    ["available", "missing"],
  );
});

test("boxscore helper scoreline and player sorting favor starters first", () => {
  assert.equal(
    boxscorePageTesting.buildScoreline({
      homeTeam: {
        teamName: "Visionaries",
        score: 99,
      },
      awayTeam: {
        teamName: "Rivals",
        score: 91,
      },
    } as any),
    "Visionaries 99 - 91 Rivals",
  );

  assert.deepStrictEqual(
    boxscorePageTesting
      .sortBoxscorePlayers([
        createBoxscorePlayer("Bench Burst", 29, false),
        createBoxscorePlayer("Starter Short", 18, true),
        createBoxscorePlayer("Starter Heavy", 34, true),
      ] as any)
      .map((player) => player.fullName),
    ["Starter Heavy", "Starter Short", "Bench Burst"],
  );
});

test("boxscore helper tolerates missing player performance arrays", () => {
  assert.equal(
    boxscorePageTesting.readPlayerStat(
      {
        fullName: "Legacy Cache Guard",
      } as any,
      "pts",
    ),
    "N/A",
  );
});

test("opponent forecast polling stops after terminal statuses", () => {
  assert.equal(
    dashboardTesting.isOpponentForecastTerminalStatus("SUCCEEDED"),
    true,
  );
  assert.equal(
    dashboardTesting.isOpponentForecastTerminalStatus("FAILED"),
    true,
  );
  assert.equal(
    dashboardTesting.isOpponentForecastTerminalStatus("INVOKING_MODEL"),
    false,
  );
});

test("next-game recommendation polling stops after terminal statuses", () => {
  assert.equal(
    dashboardTesting.isNextGameRecommendationTerminalStatus("SUCCEEDED"),
    true,
  );
  assert.equal(
    dashboardTesting.isNextGameRecommendationTerminalStatus("FAILED"),
    true,
  );
  assert.equal(
    dashboardTesting.isNextGameRecommendationTerminalStatus(
      "BUILDING_PLANNER",
    ),
    false,
  );
});

test("next-game recommendation blocked reasons prioritize next-opponent visibility and forecast readiness", () => {
  assert.equal(
    dashboardTesting.resolveNextGameRecommendationBlockedReason({
      isScoutViewingNextOpponent: false,
      isLoadingOpponentForecast: false,
      nextGameRecommendationError: null,
      nextMatch: {
        matchId: "m-1",
        opponentTeamId: "opp-1",
        opponentTeamName: "Rivals",
        startTime: "2026-04-09T00:00:00.000Z",
        type: "League",
        isHome: true,
      },
      opponentForecast: null,
    }),
    "Open Scout on your actual scheduled next opponent to use this recommendation tool.",
  );

  assert.equal(
    dashboardTesting.resolveNextGameRecommendationBlockedReason({
      isScoutViewingNextOpponent: true,
      isLoadingOpponentForecast: false,
      nextGameRecommendationError: null,
      nextMatch: {
        matchId: "m-1",
        opponentTeamId: "opp-1",
        opponentTeamName: "Rivals",
        startTime: "2026-04-09T00:00:00.000Z",
        type: "League",
        isHome: true,
      },
      opponentForecast: null,
    }),
    "Generate a successful opponent forecast for this next opponent before requesting recommendations.",
  );
});

test("lineup helper dependency state distinguishes loading, error, and ready", () => {
  assert.deepStrictEqual(
    workspaceHookTesting.resolveLineupHelperDependencyState({
      connected: true,
      errorMessage: null,
      isPending: true,
      required: true,
    }),
    {
      errorMessage: null,
      status: "loading",
    },
  );
  assert.deepStrictEqual(
    workspaceHookTesting.resolveLineupHelperDependencyState({
      connected: true,
      errorMessage: "Lineup helper unavailable",
      isPending: false,
      required: true,
    }),
    {
      errorMessage: "Lineup helper unavailable",
      status: "error",
    },
  );
  assert.deepStrictEqual(
    workspaceHookTesting.resolveLineupHelperDependencyState({
      connected: true,
      errorMessage: null,
      isPending: false,
      required: true,
    }),
    {
      errorMessage: null,
      status: "ready",
    },
  );
});

test("workspace bootstrap auto-refreshes only once after connected empty states settle", () => {
  assert.equal(
    workspaceHookTesting.shouldAutoRefreshWorkspace({
      connected: true,
      hasAttemptedAutoRefresh: false,
      hasWorkspace: false,
      isLoadingWorkspaceData: false,
      isRefreshingWorkspace: false,
      showCredentialForm: false,
    }),
    true,
  );
  assert.equal(
    workspaceHookTesting.shouldAutoRefreshWorkspace({
      connected: true,
      hasAttemptedAutoRefresh: true,
      hasWorkspace: false,
      isLoadingWorkspaceData: false,
      isRefreshingWorkspace: false,
      showCredentialForm: false,
    }),
    false,
  );
  assert.equal(
    workspaceHookTesting.shouldAutoRefreshWorkspace({
      connected: true,
      hasAttemptedAutoRefresh: false,
      hasWorkspace: false,
      isLoadingWorkspaceData: true,
      isRefreshingWorkspace: false,
      showCredentialForm: false,
    }),
    false,
  );
  assert.equal(
    workspaceHookTesting.shouldAutoRefreshWorkspace({
      connected: true,
      hasAttemptedAutoRefresh: false,
      hasWorkspace: true,
      isLoadingWorkspaceData: false,
      isRefreshingWorkspace: false,
      showCredentialForm: false,
    }),
    false,
  );
  assert.equal(
    workspaceHookTesting.shouldAutoRefreshWorkspace({
      connected: true,
      hasAttemptedAutoRefresh: false,
      hasWorkspace: false,
      isLoadingWorkspaceData: false,
      isRefreshingWorkspace: false,
      showCredentialForm: true,
    }),
    false,
  );
});

test("next-game usable roster copy separates loading, error, and exclusion-driven empty states", () => {
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveUsableRosterState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      lineupHelper: null,
      lineupHelperState: {
        errorMessage: null,
        status: "loading",
      },
    }),
    {
      controlsDisabled: true,
      summary: "Loading your saved roster before coach exclusions can be applied.",
    },
  );
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveUsableRosterState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      lineupHelper: null,
      lineupHelperState: {
        errorMessage: "Lineup helper unavailable",
        status: "error",
      },
    }),
    {
      controlsDisabled: true,
      summary: "Lineup helper unavailable",
    },
  );
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveUsableRosterState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      lineupHelper: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [],
        snapshotWarnings: [],
      },
      lineupHelperState: {
        errorMessage: null,
        status: "ready",
      },
    }),
    {
      controlsDisabled: false,
      summary: "0 players available after coach exclusions.",
    },
  );
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveUsableRosterState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      lineupHelper: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [],
        snapshotWarnings: [{ playerId: "p1", fullName: "Guard", warning: "Missing" }],
      },
      lineupHelperState: {
        errorMessage: null,
        status: "ready",
      },
    }),
    {
      controlsDisabled: false,
      summary:
        "0 players currently available. Missing canonical skill snapshots are keeping the saved roster unavailable.",
    },
  );
});

test("next-game recommendation blocking uses lineup helper status before empty-roster copy", () => {
  const nextMatch = {
    isHome: true,
    matchId: "m-1",
    opponentTeamId: "opp-1",
    opponentTeamName: "Rivals",
    startTime: "2026-04-09T00:00:00.000Z",
    type: "League",
  };

  assert.equal(
    nextGameWizardTesting.resolveRecommendationBlockedReason({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      forecast: null,
      lineupHelper: null,
      lineupHelperState: {
        errorMessage: null,
        status: "loading",
      },
      nextMatch,
      snapshotWarningCount: 0,
      sourceMatchId: null,
    }),
    "Lineup helper context is still loading for your club.",
  );
  assert.equal(
    nextGameWizardTesting.resolveRecommendationBlockedReason({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      forecast: null,
      lineupHelper: null,
      lineupHelperState: {
        errorMessage: "Lineup helper unavailable",
        status: "error",
      },
      nextMatch,
      snapshotWarningCount: 0,
      sourceMatchId: null,
    }),
    "Lineup helper unavailable",
  );
  assert.equal(
    nextGameWizardTesting.resolveRecommendationBlockedReason({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      forecast: null,
      lineupHelper: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [],
        snapshotWarnings: [],
      },
      lineupHelperState: {
        errorMessage: null,
        status: "ready",
      },
      nextMatch,
      snapshotWarningCount: 0,
      sourceMatchId: null,
    }),
    "No usable roster remains after applying your exclusions.",
  );
  assert.equal(
    nextGameWizardTesting.resolveRecommendationBlockedReason({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      forecast: null,
      lineupHelper: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [],
        snapshotWarnings: [{ playerId: "p1", fullName: "Guard", warning: "Missing" }],
      },
      lineupHelperState: {
        errorMessage: null,
        status: "ready",
      },
      nextMatch,
      snapshotWarningCount: 1,
      sourceMatchId: null,
    }),
    "No usable roster is currently available because every saved player is missing a canonical skill snapshot.",
  );
});

test("next-game switches the blocked primary action to targeted roster repair for all-missing snapshots", () => {
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveOwnerRosterRepairState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      lineupHelper: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [
          {
            available: false,
            fullName: "Guard",
            playerId: "p1",
            snapshotWarning: "Missing canonical snapshot",
          },
        ],
        snapshotWarnings: [{ playerId: "p1", fullName: "Guard", warning: "Missing canonical snapshot" }],
      } as any,
      lineupHelperState: {
        errorMessage: null,
        status: "ready",
      },
      repairExhausted: false,
    }),
    {
      blockedByMissingSnapshots: true,
      shouldOfferRepair: true,
    },
  );
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveOwnerRosterRepairState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      lineupHelper: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [
          {
            available: false,
            fullName: "Guard",
            playerId: "p1",
            snapshotWarning: "Missing canonical snapshot",
          },
        ],
        snapshotWarnings: [{ playerId: "p1", fullName: "Guard", warning: "Missing canonical snapshot" }],
      } as any,
      lineupHelperState: {
        errorMessage: null,
        status: "ready",
      },
      repairExhausted: true,
    }),
    {
      blockedByMissingSnapshots: true,
      shouldOfferRepair: false,
    },
  );
});

test("next-game wizard progress keeps later steps locked until prerequisites are ready", () => {
  assert.deepStrictEqual(
    nextGameWizardTesting.resolveNextGameWizardStepStates({
      final: {
        error: null,
        ready: false,
        working: false,
      },
      forecast: {
        error: null,
        ready: false,
        working: false,
      },
      recommendation: {
        blocked: true,
        error: null,
        ready: false,
        working: false,
      },
      roster: {
        error: null,
        ready: false,
        working: true,
      },
    }),
    {
      final: "upcoming",
      forecast: "upcoming",
      goal: "complete",
      recommendation: "upcoming",
      roster: "working",
    },
  );

  assert.deepStrictEqual(
    nextGameWizardTesting.resolveNextGameWizardStepStates({
      final: {
        error: null,
        ready: true,
        working: false,
      },
      forecast: {
        error: null,
        ready: true,
        working: false,
      },
      recommendation: {
        blocked: false,
        error: null,
        ready: true,
        working: false,
      },
      roster: {
        error: null,
        ready: true,
        working: false,
      },
    }),
    {
      final: "current",
      forecast: "complete",
      goal: "complete",
      recommendation: "complete",
      roster: "complete",
    },
  );
});

test("next-game auto-run selectors only fire for safe first-pass work", () => {
  assert.equal(
    nextGameWizardTesting.shouldAutoRepairOwnerRoster({
      excludedPlayerCount: 0,
      repairPending: false,
      shouldOfferRepair: true,
    }),
    true,
  );
  assert.equal(
    nextGameWizardTesting.shouldAutoRepairOwnerRoster({
      excludedPlayerCount: 1,
      repairPending: false,
      shouldOfferRepair: true,
    }),
    false,
  );

  assert.equal(
    nextGameWizardTesting.shouldAutoSubmitOpponentForecast({
      forecast: null,
      pending: false,
      teamId: "opp-1",
    }),
    true,
  );
  assert.equal(
    nextGameWizardTesting.shouldAutoSubmitOpponentForecast({
      forecast: {
        status: "FAILED",
      },
      pending: false,
      teamId: "opp-1",
    } as any),
    false,
  );

  assert.equal(
    nextGameWizardTesting.shouldAutoSubmitNextGameRecommendation({
      blockedReason: null,
      error: null,
      pending: false,
      recommendation: null,
    }),
    true,
  );
  assert.equal(
    nextGameWizardTesting.shouldAutoSubmitNextGameRecommendation({
      blockedReason: null,
      error: "Recommendation failed",
      pending: false,
      recommendation: null,
    }),
    false,
  );
  assert.equal(
    nextGameWizardTesting.shouldAutoSubmitNextGameRecommendation({
      blockedReason: null,
      error: null,
      pending: false,
      recommendation: {
        result: {
          stale: true,
        },
        status: "SUCCEEDED",
      },
    } as any),
    true,
  );
});

test("next-game recommendation timeline shows completed, active, and pending phases", () => {
  assert.deepStrictEqual(
    nextGameWizardTesting.buildRecommendationPhaseTimeline({
      completedPhases: [
        {
          completedAt: "2026-04-14T17:51:41.000Z",
          durationMs: 6000,
          phaseKey: "RESOLVING_CONTEXT",
          startedAt: "2026-04-14T17:51:35.000Z",
          summary: "Resolved context",
        },
      ],
      completedUnits: 20,
      context: null,
      currentPhaseStartedAt: "2026-04-14T17:51:41.000Z",
      phaseCount: 4,
      phaseIndex: 2,
      phaseKey: "OPTIMIZING_LINEUPS",
      summary: "Optimizing usable lineups: 20 of 70 tactic pairs evaluated.",
      totalUnits: 70,
      unitLabel: "tactic pairs",
      updatedAt: "2026-04-14T17:51:47.000Z",
    } as any),
    [
      {
        detail: "Completed in 6s",
        key: "RESOLVING_CONTEXT",
        label: "Resolve context",
        state: "complete",
      },
      {
        detail: "20/70 tactic pairs",
        key: "OPTIMIZING_LINEUPS",
        label: "Optimize lineups",
        state: "active",
      },
      {
        detail: "Waiting",
        key: "SCORING_MATCHUPS",
        label: "Score matchups",
        state: "pending",
      },
      {
        detail: "Waiting",
        key: "BUILDING_PLANNER",
        label: "Build planner",
        state: "pending",
      },
    ],
  );
});

test("next-game recommendation diagnostics explain cached workspace reuse", () => {
  assert.equal(nextGameWizardTesting.formatDurationMs(6100), "6s");
  assert.match(
    nextGameWizardTesting.formatWorkspaceCacheDetail({
      workspaceCacheState: "hit",
      workspaceSyncedAt: "2026-04-14T17:51:27.000Z",
    }),
    /^Cached workspace from /,
  );
});

test("next-game defensive switch swaps existing assignments instead of creating duplicates", () => {
  assert.deepStrictEqual(
    nextGameWizardTesting.applyDefensiveSwitchSwap(
      {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
      "pg",
      "SG",
    ),
    {
      pg: "SG",
      sg: "PG",
      sf: "SF",
      pf: "PF",
      c: "C",
    },
  );
  assert.equal(
    nextGameWizardTesting.isStandardDefensiveSwitch({
      pg: "PG",
      sg: "SG",
      sf: "SF",
      pf: "PF",
      c: "C",
    }),
    true,
  );
});

test("lineup helper switches optimize into targeted roster repair for all-missing snapshots", () => {
  assert.deepStrictEqual(
    lineupHelperTesting.resolveOwnerRosterRepairState({
      availableRosterCount: 0,
      excludedPlayerCount: 0,
      repairExhausted: false,
      workspaceError: null,
      workspaceLoading: false,
      workspaceRecord: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        roster: [
          {
            available: false,
            fullName: "Guard",
            playerId: "p1",
            snapshotWarning: "Missing canonical snapshot",
          },
        ],
        snapshotWarnings: [{ playerId: "p1", fullName: "Guard", warning: "Missing canonical snapshot" }],
      } as any,
    }),
    {
      blockedByMissingSnapshots: true,
      shouldOfferRepair: true,
    },
  );
});

test("next-game wizard auto-runs targeted roster repair and no longer hides planner detail", () => {
  const nextGameSource = readFileSync(
    new URL("../app/next-game-wizard-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    nextGameSource,
    /useEffect[\s\S]{0,400}repairOwnerRosterMutation\.mutateAsync/,
  );
  assert.doesNotMatch(
    nextGameSource,
    /Inspect planner detail/,
  );
});

test("dashboard app passes explicit lineup helper dependency state into the next-game wizard", () => {
  const source = readFileSync(
    new URL("../app/dashboard-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<NextGameWizardPanel[\s\S]*lineupHelperState=\{lineupHelperDependencyState\}/,
  );
  assert.match(source, /activeSection !== "next-game"/);
});

test("dashboard onboarding refreshes the workspace immediately after a successful connection", () => {
  const source = readFileSync(
    new URL("../app/dashboard-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /onConnected=\{async \(status\) => \{[\s\S]*if \(status === "CONNECTED"\) \{[\s\S]*if \(activeSection === "next-game"\) \{[\s\S]*await refreshNextGameAfterConnectionUpdate\(queryClient\);[\s\S]*return;[\s\S]*\}[\s\S]*await handleRefresh\(\);/,
  );
});

test("forecast context can still resolve from scout summary when schedule data is absent", () => {
  assert.equal(
    dashboardTesting.resolveForecastTeamId({
      requestedTeamId: "opp-1",
      schedule: null,
      summary: {
        matchupPerspective: {
          opponentTeamId: "opp-1",
        },
        teamName: "Rivals",
      },
      teamId: "opp-1",
    } as any),
    "opp-1",
  );
});

test("live-match scout rollover messaging only appears for the default next-scout target", () => {
  assert.equal(
    dashboardTesting.resolveScoutEventWindowMessage({
      nextMatch: {
        matchId: "live-match",
        opponentTeamId: "live-opp",
        opponentTeamName: "Live Opponent",
        startTime: "2026-04-11T19:00:00.000Z",
        type: "League",
        isHome: true,
      },
      nextScoutMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      selectedScoutTeamId: null,
    }),
    "A live BuzzerBeater match is in progress, so this view is showing Next Opponent as your next scheduled opponent until the current game window ends.",
  );

  assert.equal(
    dashboardTesting.resolveScoutEventWindowMessage({
      nextMatch: {
        matchId: "live-match",
        opponentTeamId: "live-opp",
        opponentTeamName: "Live Opponent",
        startTime: "2026-04-11T19:00:00.000Z",
        type: "League",
        isHome: true,
      },
      nextScoutMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      selectedScoutTeamId: "manual-opp",
    }),
    null,
  );

  assert.equal(
    dashboardTesting.resolveScoutEventWindowMessage({
      nextMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      nextScoutMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      selectedScoutTeamId: null,
    }),
    null,
  );
});

test("scout team changes clear dependent filters exactly once while same-team opens refetch", () => {
  assert.deepStrictEqual(
    dashboardTesting.resolveScoutTeamSelectionAction({
      nextTeamId: "opp-2",
      resolvedTeamId: "opp-1",
      urlTeamId: "opp-1",
    }),
    {
      kind: "update-url",
      nextState: {
        scoutSeason: null,
        scoutTeam: "opp-2",
        scoutTypes: null,
      },
    },
  );

  assert.deepStrictEqual(
    dashboardTesting.resolveScoutTeamSelectionAction({
      nextTeamId: "opp-1",
      resolvedTeamId: "opp-1",
      urlTeamId: "opp-1",
    }),
    {
      kind: "refetch",
    },
  );
});

test("same scout filters refetch while changed filters update the URL state", () => {
  assert.deepStrictEqual(
    dashboardTesting.resolveScoutFilterApplyAction({
      currentCompetitionKeys: ["LEAGUE", "TV"],
      currentSeason: 71,
      nextCompetitionKeys: ["TV", "LEAGUE"],
      nextSeason: 71,
    }),
    {
      kind: "refetch",
    },
  );

  assert.deepStrictEqual(
    dashboardTesting.resolveScoutFilterApplyAction({
      currentCompetitionKeys: ["LEAGUE"],
      currentSeason: 71,
      nextCompetitionKeys: ["LEAGUE", "PLAYOFFS"],
      nextSeason: 70,
    }),
    {
      kind: "update-url",
      nextState: {
        scoutSeason: 70,
        scoutTypes: ["LEAGUE", "PLAYOFFS"],
      },
    },
  );
});

test("scout schedule status copy distinguishes stale-snapshot fallback from missing schedule fallback", () => {
  assert.equal(
    dashboardTesting.resolveScoutScheduleStatusMessage({
      hasSchedule: true,
      hasSummary: true,
      scheduleError: "execution timed out",
    }),
    "The opponent summary stayed loaded, but the season schedule could not be refreshed. Showing the last successful schedule snapshot.",
  );

  assert.equal(
    dashboardTesting.resolveScoutScheduleEmptyStateMessage({
      hasSummary: true,
      scoutMessage: null,
      scheduleError: "execution timed out",
    }),
    "The season schedule is unavailable right now. Try Apply again or reopen the team view.",
  );

  assert.equal(
    dashboardTesting.resolveScoutScheduleEmptyStateMessage({
      hasSummary: true,
      scoutMessage:
        "A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for your next opponent until the game window ends.",
      scheduleError: null,
    }),
    "A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for your next opponent until the game window ends.",
  );
});

function createRosterPlayer(
  name: string,
  overrides: Partial<{
    available: boolean;
    dmi: number | null;
    skills: Partial<Record<string, number>>;
  }> = {},
) {
  return {
    playerId: name,
    fullName: name,
    available: overrides.available ?? true,
    bestPosition: "SF",
    age: 27,
    salary: 100000,
    gameShape: "strong",
    dmi: overrides.dmi ?? 100000,
    skills: {
      js: 10,
      jr: 10,
      od: 10,
      ha: 10,
      dr: 10,
      pa: 10,
      is: 10,
      id: 10,
      rb: 10,
      sb: 10,
      st: 10,
      ft: 10,
      ex: 10,
      gs: 10,
      ...overrides.skills,
    },
  };
}

function createBoxscorePlayer(
  fullName: string,
  minutes: number,
  isStarter: boolean,
) {
  return {
    playerId: fullName,
    fullName,
    minutes,
    isStarter,
    performance: [],
  };
}
