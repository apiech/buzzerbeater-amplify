import assert from "node:assert/strict";
import test from "node:test";

import {
  getMyTeamHighlights,
  submitMyTeamHighlightsScan,
} from "../amplify/data/_backend/team-highlights";
import { buildExecutionName } from "../amplify/data/_backend/step-functions";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

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

test("buildExecutionName keeps readable names when the full key fits", () => {
  assert.equal(
    buildExecutionName("team-highlights", "user-1:team-1:2026-03-15T12:00:00.000Z"),
    "team-highlights-user-1-team-1-2026-03-15T12-00-00-000Z",
  );
});

test("buildExecutionName preserves uniqueness for long keys", () => {
  const first = buildExecutionName(
    "team-highlights",
    "12345678-1234-1234-1234-123456789abc:163730:2026-04-06T12:00:00.000Z",
  );
  const second = buildExecutionName(
    "team-highlights",
    "12345678-1234-1234-1234-123456789abc:163730:2026-04-06T12:05:00.000Z",
  );

  assert.notEqual(first, second);
  assert.ok(first.length <= 80);
  assert.ok(second.length <= 80);
  assert.match(first, /^team-highlights-/);
  assert.match(second, /^team-highlights-/);
});

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
        updatedAt: "2026-03-15T11:55:00.000Z",
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

test("submitMyTeamHighlightsScan replaces a stale active scan", async () => {
  const writtenStatuses: Array<Record<string, unknown>> = [];

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
        status: "WAITING_FOR_MATCH_JOBS",
        teamId: "team-1",
        teamName: "Alpha",
        updatedAt: "2026-03-15T09:10:00.000Z",
        userId: "user-1",
      }),
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      now: () => new Date("2026-03-15T12:00:00.000Z"),
      putTeamHighlightsStatus: async (_env, record) => {
        writtenStatuses.push(record as unknown as Record<string, unknown>);
      },
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async () =>
        "arn:aws:states:us-east-1:123456789012:execution:team-highlights:scan-2",
    },
  );

  assert.equal(result.queued, true);
  assert.equal(writtenStatuses.length, 2);
  assert.equal(writtenStatuses[0].status, "QUEUED");
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
        brokenMatches: [
          {
            awayTeamName: "Great 8",
            boxscoreUrl:
              "https://www.buzzerbeater.com/match/1006000001/boxscore.aspx",
            homeTeamName: "Big 8",
            issue: "BBXmlApiError: ServerError (boxscore.aspx)",
            matchId: "1006000001",
            season: 8,
            startTime: "2009-04-16T00:00:00.000Z",
          },
        ],
        currentSeason: 52,
        matchesCompleted: 4,
        requestedAt: "2026-03-15T09:00:00.000Z",
        status: "SUCCEEDED",
        teamId: "team-1",
        teamName: "Alpha",
        updatedAt: "2026-03-15T09:12:00.000Z",
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
  assert.equal((result as { scanStatus: { currentSeason: number | null } }).scanStatus.currentSeason, 52);
  assert.equal((result as { scanStatus: { matchesCompleted: number | null } }).scanStatus.matchesCompleted, 4);
  assert.equal(
    (
      result as {
        scanStatus: { brokenMatches: Array<{ boxscoreUrl: string }> };
      }
    ).scanStatus.brokenMatches[0].boxscoreUrl,
    "https://www.buzzerbeater.com/match/1006000001/boxscore.aspx",
  );
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
