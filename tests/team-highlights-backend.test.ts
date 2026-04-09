import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMyTeamHighlightsData,
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
    viewerUrl: `https://buzzerbeater.com/match/match-${index}/reportmatch.aspx?realTime=2875`,
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
          assertBbCredentialReadable: async () => {},
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
      assertBbCredentialReadable: async () => {},
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
      assertBbCredentialReadable: async () => {},
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
      assertBbCredentialReadable: async () => {},
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
  const firstStatus = writtenStatuses[0];
  assert.ok(firstStatus);
  assert.equal(firstStatus.status, "QUEUED");
});

test("submitMyTeamHighlightsScan fails before queueing when saved credentials are stale", async () => {
  let wroteStatus = false;
  let startedWorkflow = false;

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
          assertBbCredentialReadable: async () => {
            throw new Error(
              "Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted.",
            );
          },
          getBbConnection: async () => ({
            teamId: "team-1",
            teamName: "Alpha",
          }) as any,
          getTeamHighlightsStatus: async () => null,
          listTrackedTeamsForUser: async () => [createTrackedTeam()],
          now: () => new Date("2026-03-15T12:00:00.000Z"),
          putTeamHighlightsStatus: async () => {
            wroteStatus = true;
          },
          requireFeatureAccess: async () => "premium",
          startWorkflowExecution: async () => {
            startedWorkflow = true;
            return "arn:aws:states:us-east-1:123456789012:execution:team-highlights:scan-3";
          },
        },
      ),
    /Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted\./i,
  );

  assert.equal(wroteStatus, false);
  assert.equal(startedWorkflow, false);
});

test("getMyTeamHighlights filters, paginates, and summarizes stored rows", async () => {
  const allMoments = Array.from({ length: 26 }, (_, index) => createMoment(index));

  const result: Awaited<ReturnType<typeof getMyTeamHighlights>> = await getMyTeamHighlights(
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
        matchesAlreadyRecorded: 20,
        matchesCompleted: 4,
        matchesProcessedThisRun: 4,
        matchesWithMoments: 3,
        matchesWithoutMoments: 1,
        momentsWritten: 6,
        requestedAt: "2026-03-15T09:00:00.000Z",
        status: "SUCCEEDED",
        teamId: "team-1",
        teamName: "Alpha",
        unsupportedSeasonsWarning:
          "bb-events does not currently track buzzerbeaters in seasons 1-14.",
        updatedAt: "2026-03-15T09:12:00.000Z",
        userId: "user-1",
      }),
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      queryTeamMoments: async () => allMoments as any,
    },
  );

  assert.equal(result.items.length, 25);
  assert.equal(result.summary.totalMoments, 26);
  assert.equal(result.summary.forMoments, 13);
  assert.equal(result.summary.againstMoments, 13);
  assert.equal(result.summary.outcomeChangeMoments, 9);
  assert.equal(result.team.teamId, "team-1");
  const scanStatus = result.scanStatus;
  assert.ok(scanStatus);
  assert.equal(scanStatus.currentSeason, 52);
  assert.equal(scanStatus.matchesAlreadyRecorded, 20);
  assert.equal(scanStatus.momentsWritten, 6);
  assert.equal(scanStatus.matchesCompleted, 4);
  assert.equal(
    (result.items[0] as { viewerUrl: string | null }).viewerUrl,
    "https://buzzerbeater.com/match/match-0/reportmatch.aspx?realTime=2875",
  );
  const firstBrokenMatch = scanStatus.brokenMatches?.[0];
  assert.ok(firstBrokenMatch);
  assert.equal(
    firstBrokenMatch.boxscoreUrl,
    "https://www.buzzerbeater.com/match/1006000001/boxscore.aspx",
  );
  assert.ok(result.nextCursor);

  const nextPage: Awaited<ReturnType<typeof getMyTeamHighlights>> = await getMyTeamHighlights(
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
  );

  assert.equal(nextPage.items.length, 1);
  assert.equal(nextPage.nextCursor, null);
});

test("clearMyTeamHighlightsData deletes team moments, clears coverage, and removes the latest status", async () => {
  const deletedMoments: Array<Record<string, unknown>> = [];
  const clearedCoverage: Array<Record<string, unknown>> = [];
  const deletedStatuses: Array<{ teamId: string; userId: string }> = [];

  const result = await clearMyTeamHighlightsData(
    {
      env: {},
      identity: { sub: "user-1" },
    },
    {
      clearTeamProjectionCoverage: async (_env, items) => {
        clearedCoverage.push(
          ...Array.from(items, (item) => ({ ...item }) as Record<string, unknown>),
        );
      },
      deleteTeamHighlightsStatus: async (_env, userId, teamId) => {
        deletedStatuses.push({ teamId, userId });
      },
      deleteTeamMoments: async (_env, items) => {
        deletedMoments.push(
          ...Array.from(items, (item) => ({ ...item }) as Record<string, unknown>),
        );
      },
      getBbConnection: async () => ({
        teamId: "team-1",
        teamName: "Alpha",
      }) as any,
      getTeamHighlightsStatus: async () => ({
        requestedAt: "2026-03-15T09:00:00.000Z",
        status: "SUCCEEDED",
        teamId: "team-1",
        teamName: "Alpha",
        updatedAt: "2026-03-15T09:12:00.000Z",
        userId: "user-1",
      }),
      listTrackedTeamsForUser: async () => [createTrackedTeam()],
      now: () => new Date("2026-03-15T12:00:00.000Z"),
      queryTeamMoments: async () => [createMoment(0), createMoment(1)] as any,
      queryTeamProjections: async () =>
        [
          {
            highlightsMomentCount: 1,
            highlightsStatus: "READY",
            matchId: "match-0",
            seasonStartMatchKey: "72#2026-03-31T20:00:00.000Z#match-0",
            teamId: "team-1",
          },
          {
            matchId: "match-1",
            seasonStartMatchKey: "72#2026-03-30T20:00:00.000Z#match-1",
            teamId: "team-1",
          },
        ] as any,
      requireFeatureAccess: async () => "premium",
    },
  );

  assert.deepStrictEqual(result, {
    clearedCoverageCount: 1,
    deletedMomentCount: 2,
    teamId: "team-1",
    teamName: "Alpha",
  });
  assert.equal(deletedMoments.length, 2);
  assert.equal(clearedCoverage.length, 1);
  assert.deepStrictEqual(deletedStatuses, [{ teamId: "team-1", userId: "user-1" }]);
});
