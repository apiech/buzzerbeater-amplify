import assert from "node:assert/strict";
import test from "node:test";

import {
  getMyTeamHighlights,
  submitMyTeamHighlightsScan,
} from "../amplify/data/_backend/team-highlights";

function createMoment(index: number, overrides: Record<string, unknown> = {}) {
  return {
    matchId: `match-${index}`,
    momentId: `moment-${index}`,
    momentSortKey: `2026-03-${String(31 - index).padStart(2, "0")}T20:00:00.000Z#match-${index}#moment-${index}`,
    perspective: index % 2 === 0 ? "FOR" : "AGAINST",
    recordId: `record-${index}`,
    startTime: `2026-03-${String(31 - index).padStart(2, "0")}T20:00:00.000Z`,
    teamId: "team-1",
    teamName: "Alpha",
    outcomeChanged: index % 3 === 0,
    ...overrides,
  };
}

function createTrackedTeam() {
  return {
    isPrimary: true,
    teamId: "team-1",
    name: "Alpha",
    fetchedAt: "2026-03-15T00:00:00.000Z",
    userId: "user-1",
  };
}

test("submitMyTeamHighlightsScan rejects free-plan users before queueing work", async () => {
  await assert.rejects(
    () =>
      submitMyTeamHighlightsScan(
        {
          env: {},
          identity: { sub: "user-1" },
          stateMachineArn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
        },
        {
          getBbConnection: async () => ({
            teamId: "team-1",
            teamName: "Alpha",
          }) as any,
          getTeamHighlightsStatus: async () => null,
          listTrackedTeamsForUser: async () => [createTrackedTeam()],
          now: () => new Date("2026-03-15T00:00:00.000Z"),
          putTeamHighlightsStatus: async () => {},
          requireFeatureAccess: async () => {
            throw new Error("Premium is required to scan team highlights.");
          },
          startWorkflowExecution: async () => {
            throw new Error("startWorkflowExecution should not be called");
          },
        },
      ),
    /premium is required to scan team highlights/i,
  );
});

test("submitMyTeamHighlightsScan writes queued status and enqueues work", async () => {
  const writtenStatuses: Array<Record<string, unknown>> = [];
  let startedExecution:
    | {
        executionName: string;
        message: Record<string, string>;
        stateMachineArn: string;
      }
    | null = null;

  const result = await submitMyTeamHighlightsScan(
    {
      env: {
        BILLING_DEFAULT_PLAN: "premium",
      },
      identity: { sub: "user-1" },
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
    },
    {
      getBbConnection: async () => ({
        teamId: "team-1",
        teamName: "Alpha",
      }) as any,
      getTeamHighlightsStatus: async () => null,
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      now: () => new Date("2026-03-15T12:00:00.000Z"),
      putTeamHighlightsStatus: async (_env, record) => {
        writtenStatuses.push(record as unknown as Record<string, unknown>);
      },
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async (
        stateMachineArn,
        executionName,
        message,
      ) => {
        startedExecution = { executionName, message, stateMachineArn };
        return "arn:aws:states:us-east-1:123456789012:execution:team-highlights:scan-1";
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:team-highlights:scan-1",
    queued: true,
    requestedAt: "2026-03-15T12:00:00.000Z",
    status: "QUEUED",
    teamId: "team-1",
    teamName: "Alpha",
  });
  assert.deepStrictEqual(writtenStatuses[0], {
    executionArn: null,
    requestedAt: "2026-03-15T12:00:00.000Z",
    status: "QUEUED",
    teamId: "team-1",
    teamName: "Alpha",
    updatedAt: "2026-03-15T12:00:00.000Z",
    userId: "user-1",
  });
  assert.deepStrictEqual(writtenStatuses[1], {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:team-highlights:scan-1",
    requestedAt: "2026-03-15T12:00:00.000Z",
    status: "QUEUED",
    teamId: "team-1",
    teamName: "Alpha",
    updatedAt: "2026-03-15T12:00:00.000Z",
    userId: "user-1",
  });
  assert.deepStrictEqual(startedExecution, {
    executionName: "team-highlights-user-1-team-1-2026-03-15T12-00-00-000Z",
    message: {
      requestedAt: "2026-03-15T12:00:00.000Z",
      teamId: "team-1",
      userId: "user-1",
    },
    stateMachineArn:
      "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
  });
});

test("submitMyTeamHighlightsScan reuses an active scan instead of duplicating it", async () => {
  const result = await submitMyTeamHighlightsScan(
    {
      env: {},
      identity: { sub: "user-1" },
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
    },
    {
      getBbConnection: async () => ({
        teamId: "team-1",
        teamName: "Alpha",
      }) as any,
      getTeamHighlightsStatus: async () => ({
        requestedAt: "2026-03-15T09:00:00.000Z",
        status: "RESOLVING_HISTORY",
        teamId: "team-1",
        teamName: "Alpha",
        userId: "user-1",
      }),
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      now: () => new Date("2026-03-15T12:00:00.000Z"),
      putTeamHighlightsStatus: async () => {
        throw new Error("putTeamHighlightsStatus should not be called");
      },
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async () => {
        throw new Error("startWorkflowExecution should not be called");
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn: null,
    queued: false,
    requestedAt: "2026-03-15T09:00:00.000Z",
    status: "RESOLVING_HISTORY",
    teamId: "team-1",
    teamName: "Alpha",
  });
});

test("getMyTeamHighlights filters, paginates, and summarizes stored rows", async () => {
  const allMoments = Array.from({ length: 26 }, (_, index) => createMoment(index));

  const result = (await getMyTeamHighlights(
    {
      cursor: null,
      env: {},
      identity: { sub: "user-1" },
      onlyOutcomeChange: false,
      perspective: "both",
    },
    {
      getBbConnection: async () => ({
        teamId: "team-1",
        teamName: "Alpha",
      }) as any,
      getTeamHighlightsStatus: async () => ({
        requestedAt: "2026-03-15T09:00:00.000Z",
        status: "SUCCEEDED",
        teamId: "team-1",
        teamName: "Alpha",
        userId: "user-1",
      }),
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      queryTeamMoments: async () => allMoments as any,
    },
  )) as {
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
    summary: Record<string, number>;
    team: { teamId: string; teamName: string | null };
  };

  assert.equal(result.items.length, 25);
  assert.equal(result.summary.totalMoments, 26);
  assert.equal(result.summary.forMoments, 13);
  assert.equal(result.summary.againstMoments, 13);
  assert.equal(result.summary.outcomeChangeMoments, 9);
  assert.equal(result.team.teamId, "team-1");
  assert.ok(result.nextCursor);

  const nextPage = (await getMyTeamHighlights(
    {
      cursor: result.nextCursor,
      env: {},
      identity: { sub: "user-1" },
      onlyOutcomeChange: false,
      perspective: "both",
    },
    {
      getBbConnection: async () => ({
        teamId: "team-1",
        teamName: "Alpha",
      }) as any,
      getTeamHighlightsStatus: async () => null,
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      queryTeamMoments: async () => allMoments as any,
    },
  )) as {
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
  };

  assert.equal(nextPage.items.length, 1);
  assert.equal(nextPage.nextCursor, null);
});
