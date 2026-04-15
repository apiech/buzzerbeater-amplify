import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { client } from "../app/amplify-client";
import {
  fetchConnectionRecord,
  fetchManualSalaryEstimateQuery,
  fetchSalaryCalculatorSeedQuery,
  fetchHomeWorkspaceQuery,
  repairOwnerRosterDataMutation,
  refreshLineupHelperAfterOwnerRosterRepair,
  fetchScoutTeamSummaryQuery,
  submitProductFeedbackMutation,
  fetchTeamHighlightsQuery,
  workspaceQueryKeys,
} from "../app/dashboard/workspace-query-client";

function installQueryMock<TName extends keyof typeof client.queries>(
  t: TestContext,
  name: TName,
  handler: (typeof client.queries)[TName],
) {
  const original = client.queries[name];
  client.queries[name] = handler;
  t.after(() => {
    client.queries[name] = original;
  });
}

function installMutationMock<TName extends keyof typeof client.mutations>(
  t: TestContext,
  name: TName,
  handler: (typeof client.mutations)[TName],
) {
  const original = client.mutations[name];
  client.mutations[name] = handler;
  t.after(() => {
    client.mutations[name] = original;
  });
}

function installReadMock<TName extends keyof typeof client.reads>(
  t: TestContext,
  name: TName,
  handler: (typeof client.reads)[TName],
) {
  const original = client.reads[name];
  client.reads[name] = handler;
  t.after(() => {
    client.reads[name] = original;
  });
}

test("home workspace parsing accepts key-based tendencies and omits home connection userId", async (t) => {
  installQueryMock(t, "getHomeWorkspace", async () => ({
    data: {
      connection: {
        bbLoginName: "apiech",
        status: "CONNECTED",
        teamName: "Visionaries",
      },
      league: {
        league: {
          id: "nbba",
          name: "NBBA",
        },
        standings: [],
      },
      nextMatch: null,
      nextOpponent: {
        injuries: [],
        record: {
          losses: 8,
          wins: 8,
        },
        teamId: "opp-1",
        teamName: "Rivals",
        tendencies: {
          defense: [{ count: 1, key: "ManToMan" }],
          offense: [{ count: 2, key: "Push" }],
        },
      },
      nextScoutMatch: null,
      recentMatches: [],
      syncedAt: "2026-04-11T22:07:00.000Z",
      team: {
        injuries: [],
        record: {
          losses: 6,
          wins: 10,
        },
        shortName: "Visionaries",
        teamId: "our-1",
        teamName: "Visionaries",
        topPlayers: [],
      },
    },
    errors: null,
  }));

  const workspace = await fetchHomeWorkspaceQuery();

  assert.equal(workspace.connection.userId, undefined);
  assert.deepStrictEqual(workspace.nextOpponent?.tendencies.offense, [
    { count: 2, key: "Push" },
  ]);
});

test("connection loading tolerates a connected record with a null workspace cache", async (t) => {
  installReadMock(t, "getCurrentBbConnection", async () => ({
    data: {
      bbLoginName: "apiech",
      status: "CONNECTED",
      teamId: "our-1",
      teamName: "Visionaries",
      workspaceCacheJson: null,
    },
    errors: null,
  }));

  const connection = await fetchConnectionRecord();

  assert.ok(connection);
  assert.equal(connection.status, "CONNECTED");
  assert.equal(connection.workspaceCacheJson, null);
});

test("scout summary parsing accepts key-based tendencies", async (t) => {
  installQueryMock(t, "getScoutTeamSummary", async () => ({
    data: {
      availableOpponents: [],
      message: null,
      recentMatchups: [],
      requestedTeamId: "opp-1",
      schedule: null,
      summary: {
        matchupPerspective: {
          opponentTeamId: "opp-1",
          ourTeamId: "our-1",
        },
        nextMatch: null,
        recentGames: [],
        record: {
          losses: 8,
          wins: 8,
        },
        roster: [],
        tendencies: {
          defense: [{ count: 1, key: "23Zone" }],
          offense: [{ count: 2, key: "Push" }],
        },
        teamName: "Rivals",
        topPlayers: [],
      },
      syncedAt: "2026-04-11T22:07:00.000Z",
      teamId: "opp-1",
    },
    errors: null,
  }));

  const scout = await fetchScoutTeamSummaryQuery({ teamId: "opp-1" });

  assert.ok(scout?.summary);
  assert.deepStrictEqual(scout.summary.tendencies.defense, [
    { count: 1, key: "23Zone" },
  ]);
});

test("team highlights parsing accepts string periods from the generated API contract", async (t) => {
  installQueryMock(t, "getMyTeamHighlights", async () => ({
    data: {
      filters: {
        onlyOutcomeChange: true,
        perspective: "BOTH",
      },
      items: [
        {
          comment: "Buzzer beater.",
          eventKind: "shot",
          matchId: "m-1",
          momentId: "moment-1",
          outcomeChanged: true,
          period: "Q4",
          perspective: "FOR",
          playerName: "Closer",
          recordId: "record-1",
          teamId: "team-1",
          viewerUrl: "https://example.com/viewer",
        },
      ],
      nextCursor: null,
      scanStatus: null,
      summary: {
        againstMoments: 0,
        filteredMoments: 1,
        forMoments: 1,
        outcomeChangeMoments: 1,
        totalMoments: 1,
      },
      team: {
        teamId: "team-1",
        teamName: "Visionaries",
      },
    },
    errors: null,
  }));

  const payload = await fetchTeamHighlightsQuery({
    onlyOutcomeChange: true,
    perspective: "BOTH",
  });

  assert.equal(payload?.items[0]?.period, "Q4");
});

test("product feedback mutation parses the submit result and preserves notification state", async (t) => {
  installMutationMock(t, "submitProductFeedback", async () => ({
    data: {
      id: "feedback-1",
      notified: false,
      submittedAt: "2026-04-14T20:14:00.000Z",
    },
    errors: null,
  }));

  const result = await submitProductFeedbackMutation({
    kind: "FEATURE_REQUEST",
    message: "Please add a feedback shortcut.",
    subject: "Feedback shortcut",
  });

  assert.deepStrictEqual(result, {
    id: "feedback-1",
    notified: false,
    submittedAt: "2026-04-14T20:14:00.000Z",
  });
});

test("salary calculator seed parsing accepts synced skill values above 20", async (t) => {
  installQueryMock(t, "getSalaryCalculatorSeed", async () => ({
    data: {
      bestPosition: "PG",
      currentSalary: 325000,
      fullName: "Seed Guard",
      playerId: "player-1",
      skills: {
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
      },
    },
    errors: null,
  }));

  const seed = await fetchSalaryCalculatorSeedQuery({ playerId: "player-1" });

  assert.ok(seed);
  assert.equal(seed.skills.jumpShot, 25);
  assert.equal(seed.skills.jumpRange, 23);
  assert.equal(seed.currentSalary, 325000);
});

test("manual salary estimate parsing accepts the typed source metadata payload", async (t) => {
  installQueryMock(t, "getManualSalaryEstimate", async () => ({
    data: {
      bestPosition: "PG",
      calibrationMode: "IDENTITY",
      correctionFactorApplied: 1,
      modelSource: "chromebb",
      modelSourceConfidence: "direct_public_code",
      predictedSalary: 482000,
      salaryByPosition: {
        C: 223000,
        PF: 252000,
        PG: 482000,
        SF: 342000,
        SG: 467000,
      },
    },
    errors: null,
  }));

  const estimate = await fetchManualSalaryEstimateQuery({
    input: {
      skills: {
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
      },
    },
  });

  assert.ok(estimate);
  assert.equal(estimate.predictedSalary, 482000);
  assert.equal(estimate.salaryByPosition.PG, 482000);
  assert.equal(estimate.calibrationMode, "IDENTITY");
});

test("owner roster repair mutation parses compact repair results", async (t) => {
  installMutationMock(t, "repairOwnerRosterData", async () => ({
    data: {
      completedAt: "2026-04-13T03:40:00.000Z",
      repairedPlayerCount: 11,
    },
    errors: null,
  }));

  const result = await repairOwnerRosterDataMutation();

  assert.equal(result.completedAt, "2026-04-13T03:40:00.000Z");
  assert.equal(result.repairedPlayerCount, 11);
});

test("owner roster repair refresh only replaces the lineup-helper cache", async (t) => {
  installQueryMock(t, "getLineupHelperWorkspace", async () => ({
    data: {
      availableDefenses: ["Man to man"],
      availableLocations: ["Home Court"],
      availableOffenses: ["Base Offense"],
      defaultAssignments: [],
      defaultContext: {
        defense: "Man to man",
        defensiveSwitch: {
          c: "C",
          pf: "PF",
          pg: "PG",
          sf: "SF",
          sg: "SG",
        },
        enthusiasm: 5,
        homeCourt: "Home Court",
        offense: "Base Offense",
      },
      evaluation: null,
      generatedAt: "2026-04-13T03:41:00.000Z",
      roster: [],
      snapshotWarnings: [],
      syncedAt: "2026-04-13T03:41:00.000Z",
    },
    errors: null,
  }));

  const queryClient = new QueryClient();
  queryClient.setQueryData(workspaceQueryKeys.home, {
    team: { teamName: "Visionaries" },
  });

  const refreshed =
    await refreshLineupHelperAfterOwnerRosterRepair(queryClient);

  assert.equal(
    queryClient.getQueryData(workspaceQueryKeys.lineupHelper),
    refreshed,
  );
  assert.deepStrictEqual(queryClient.getQueryData(workspaceQueryKeys.home), {
    team: { teamName: "Visionaries" },
  });
});
