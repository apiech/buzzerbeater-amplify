import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePredictionRequest,
  processPredictionJob,
  resolveConnectedInput,
  submitPredictionJob,
} from "../amplify/data/_backend/prediction";
import { requireFeatureAccess } from "../amplify/data/_backend/billing";

function expectPresent<T>(value: T | null | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}

const manualFallback = {
  home_outsideScoring: 8,
  home_insideScoring: 8,
  home_outsideDefense: 8,
  home_insideDefense: 8,
  home_rebounding: 8,
  home_offensiveFlow: 8,
  away_outsideScoring: 7,
  away_insideScoring: 7,
  away_outsideDefense: 7,
  away_insideDefense: 7,
  away_rebounding: 7,
  away_offensiveFlow: 7,
  home_offStrategy: "Base",
  home_defStrategy: "ManToMan",
  away_offStrategy: "Push",
  away_defStrategy: "23Zone",
  home_gdp_focus: "N/A",
  home_gdp_pace: "N/A",
  away_gdp_focus: "N/A",
  away_gdp_pace: "N/A",
  neutral: "0",
  effortDelta: 0,
};

function createMatchBoxscoreRecord(args: {
  matchId: string;
  teamId: string;
  opponentTeamId: string;
  offStrategy: string;
  defStrategy: string;
  gdpFocus?: string;
  gdpPace?: string;
  teamRatings: Record<string, number>;
  opponentRatings: Record<string, number>;
}) {
  return {
    matchId: args.matchId,
    boxscoreJson: {
      homeTeam: {
        defStrategy: args.defStrategy,
        gdp: {
          focus: args.gdpFocus ?? "Balanced.hit",
          pace: args.gdpPace ?? "Normal.hit",
        },
        id: args.teamId,
        offStrategy: args.offStrategy,
        ratings: args.teamRatings,
      },
      awayTeam: {
        defStrategy: "ManToMan",
        gdp: {
          focus: "Inside.hit",
          pace: "Slow.hit",
        },
        id: args.opponentTeamId,
        offStrategy: "Base",
        ratings: args.opponentRatings,
      },
    },
  };
}

test("normalizePredictionRequest rejects unsupported modes", () => {
  assert.throws(
    () => normalizePredictionRequest({ mode: "mystery" }),
    /either MANUAL or CONNECTED/i,
  );
});

test("resolveConnectedInput prefers cached boxscores and merges direct overrides", async () => {
  const homeRecord = createMatchBoxscoreRecord({
    matchId: "home-1",
    teamId: "HOME",
    opponentTeamId: "AWAY",
    offStrategy: "Motion",
    defStrategy: "32Zone",
    teamRatings: {
      outsideScoring: 12.1,
      insideScoring: 10.4,
      outsideDefense: 11.5,
      insideDefense: 10.7,
      rebounding: 9.8,
      offensiveFlow: 11.1,
    },
    opponentRatings: {
      outsideScoring: 8.2,
      insideScoring: 8.3,
      outsideDefense: 7.9,
      insideDefense: 8.1,
      rebounding: 7.8,
      offensiveFlow: 8.4,
    },
  });
  const awayRecord = createMatchBoxscoreRecord({
    matchId: "away-1",
    teamId: "AWAY",
    opponentTeamId: "HOME",
    offStrategy: "Push",
    defStrategy: "23Zone",
    teamRatings: {
      outsideScoring: 10.2,
      insideScoring: 9.7,
      outsideDefense: 8.9,
      insideDefense: 9.4,
      rebounding: 8.8,
      offensiveFlow: 9.2,
    },
    opponentRatings: {
      outsideScoring: 7.1,
      insideScoring: 7.3,
      outsideDefense: 7.2,
      insideDefense: 7.4,
      rebounding: 7.5,
      offensiveFlow: 7.6,
    },
  });

  const resolved = await resolveConnectedInput(
    {},
    "user-1",
    {
      homeSourceMatchId: "home-1",
      awaySourceMatchId: "away-1",
      homeTeamId: "HOME",
      awayTeamId: "AWAY",
      neutral: "1",
      effortDelta: 1,
      manualFallback,
    },
    {
      getMatchBoxscore: async (_env, _userId, matchId) =>
        matchId === "home-1" ? homeRecord : awayRecord,
    },
  );

  assert.equal(resolved.home_outsideScoring, 12.1);
  assert.equal(resolved.home_offStrategy, "Motion");
  assert.equal(resolved.home_gdp_focus, "Balanced.hit");
  assert.equal(resolved.away_outsideScoring, 10.2);
  assert.equal(resolved.away_defStrategy, "23Zone");
  assert.equal(resolved.away_gdp_pace, "Normal.hit");
  assert.equal(resolved.neutral, "1");
  assert.equal(resolved.effortDelta, 1);
});

test("resolveConnectedInput falls back to manual values when cache misses occur", async () => {
  const resolved = await resolveConnectedInput(
    {},
    "user-1",
    {
      homeSourceMatchId: "missing-home",
      awaySourceMatchId: "missing-away",
      homeTeamId: "HOME",
      awayTeamId: "AWAY",
      manualFallback,
    },
    {
      getMatchBoxscore: async () => null,
    },
  );

  assert.deepStrictEqual(resolved, manualFallback);
});

test("resolveConnectedInput requires explicit team ids for cached source matches", async () => {
  await assert.rejects(
    () =>
      resolveConnectedInput(
        {},
        "user-1",
        {
          homeSourceMatchId: "home-1",
          manualFallback,
        },
        {
          getMatchBoxscore: async () => null,
        },
      ),
    /homeTeamId is required/i,
  );
});

test("normalizePredictionRequest tolerates historical GDP keys in stored jobs", () => {
  const normalized = normalizePredictionRequest({
    mode: "MANUAL",
    manualInput: {
      ...manualFallback,
      home_gdp_focus: "Balanced.hit",
      home_gdp_pace: "Normal.hit",
    },
  });

  assert.equal(normalized.mode, "MANUAL");
  const manualInput = (normalized as { manualInput: Record<string, unknown> })
    .manualInput;
  assert.equal(manualInput.home_gdp_focus, "Balanced.hit");
  assert.equal(manualInput.home_gdp_pace, "Normal.hit");
});

test("normalizePredictionRequest preserves connected forecast provenance", () => {
  const normalized = normalizePredictionRequest({
    mode: "CONNECTED",
    connectedInput: {
      awaySourceMatchId: "away-1",
      forecastContext: {
        evidence: ["Analog consensus"],
        forecastGeneratedAt: "2026-03-19T00:00:00.000Z",
        forecastJobId: "job-1",
        forecastModelVersion: "forecast-v1",
        scenarioId: "scenario-1",
        scenarioLabel: "Primary",
        scenarioProbability: 0.62,
        sourceTeamId: "team-1",
      },
      homeSourceMatchId: "home-1",
    },
  });

  assert.equal(normalized.mode, "CONNECTED");
  const connectedInput = (
    normalized as { connectedInput: Record<string, unknown> }
  ).connectedInput;
  assert.deepStrictEqual(connectedInput.forecastContext, {
    evidence: ["Analog consensus"],
    forecastGeneratedAt: "2026-03-19T00:00:00.000Z",
    forecastJobId: "job-1",
    forecastModelVersion: "forecast-v1",
    scenarioId: "scenario-1",
    scenarioLabel: "Primary",
    scenarioProbability: 0.62,
    sourceTeamId: "team-1",
  });
});

test("resolveConnectedInput still fails without any usable source data", async () => {
  await assert.rejects(
    () =>
      resolveConnectedInput(
        {},
        "user-1",
        {
          homeSourceMatchId: "missing-home",
          homeTeamId: "HOME",
        },
        {
          getMatchBoxscore: async () => null,
        },
      ),
    /unavailable in cache/i,
  );
});

test("submitPredictionJob rejects free-plan users before queueing work", async () => {
  await assert.rejects(
    () =>
      submitPredictionJob(
        {
          env: {},
          identity: { sub: "user-1" },
          queueUrl: "https://queue.example.com",
          request: {
            mode: "MANUAL",
            manualInput: manualFallback,
          },
        },
        {
          createPredictionJob: async () => {
            throw new Error("createPredictionJob should not be called");
          },
          requireFeatureAccess: async () => {
            throw new Error(
              "Premium is required to use the prediction engine.",
            );
          },
          sendQueueMessage: async () => {
            throw new Error("sendQueueMessage should not be called");
          },
          updatePredictionJob: async () => {},
        },
      ),
    /premium is required/i,
  );
});

test("submitPredictionJob queues work for premium users", async () => {
  let createdRecord: { status: string; userId: string } | null = null;
  let queuedMessage: Record<string, string> | null = null;

  const result = await submitPredictionJob(
    {
      env: {},
      identity: { sub: "user-1" },
      queueUrl: "https://queue.example.com",
      request: {
        mode: "MANUAL",
        manualInput: manualFallback,
      },
    },
    {
      createPredictionJob: async (_env, input) => {
        createdRecord = input as { status: string; userId: string };
        return {
          ...(input as Record<string, unknown>),
          createdAt: "2026-03-15T00:00:00.000Z",
          updatedAt: "2026-03-15T00:00:00.000Z",
        } as any;
      },
      requireFeatureAccess: async () => "premium",
      sendQueueMessage: async (_queueUrl, message) => {
        queuedMessage = message;
      },
      updatePredictionJob: async () => {},
    },
  );

  assert.match(String(result.jobId), /^[0-9a-f-]{36}$/i);
  const record = expectPresent<{ status: string; userId: string }>(
    createdRecord,
    "createPredictionJob did not receive an input record",
  );
  assert.equal(record.userId, "user-1");
  assert.equal(record.status, "QUEUED");
  assert.deepStrictEqual(queuedMessage, {
    jobId: result.jobId,
    userId: "user-1",
  });
});

test("submitPredictionJob allows access when premium is granted by the environment default", async () => {
  let queuedMessage: Record<string, string> | null = null;

  const result = await submitPredictionJob(
    {
      env: {
        BILLING_DEFAULT_PLAN: "premium",
      },
      identity: { sub: "user-1" },
      queueUrl: "https://queue.example.com",
      request: {
        mode: "MANUAL",
        manualInput: manualFallback,
      },
    },
    {
      createPredictionJob: async (_env, input) =>
        ({
          ...(input as Record<string, unknown>),
          createdAt: "2026-03-15T00:00:00.000Z",
          updatedAt: "2026-03-15T00:00:00.000Z",
        }) as any,
      requireFeatureAccess: (args) =>
        requireFeatureAccess(args, {
          createPortalSession: async () => ({
            url: "https://example.com/portal",
          }),
          createSubscriptionCheckoutSession: async () => ({
            url: "https://example.com/checkout",
          }),
          getBillingAccount: async () => null,
          getStripeSubscription: async () => ({
            id: "sub_123",
          }),
          upsertBillingAccount: async () => {},
        }),
      sendQueueMessage: async (_queueUrl, message) => {
        queuedMessage = message;
      },
      updatePredictionJob: async () => {},
    },
  );

  assert.deepStrictEqual(queuedMessage, {
    jobId: result.jobId,
    userId: "user-1",
  });
});

test("processPredictionJob stores grid-enabled endpoint results without extra invocations", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let endpointCalls = 0;

  await processPredictionJob(
    {
      env: {},
      endpointName: "predictor-endpoint",
      messageBody: JSON.stringify({
        jobId: "job-1",
        userId: "user-1",
      }),
    },
    {
      getPredictionJob: async () =>
        ({
          id: "job-1",
          request: {
            mode: "MANUAL",
            manualInput: manualFallback,
          },
          userId: "user-1",
        }) as any,
      invokePredictionEndpoint: async (_endpointName, resolvedInput) => {
        endpointCalls += 1;
        assert.deepStrictEqual(resolvedInput, manualFallback);
        return {
          awayScore: 94.8,
          homeScore: 101.3,
          modelVersion: "bundle-v1",
          pointDiff: 6.5,
          tacticsGrid: {
            offenses: ["Base", "Motion"],
            defenses: ["ManToMan", "23Zone"],
            cells: [
              [
                {
                  awayDefense: "ManToMan",
                  awayScore: 94.8,
                  homeOffense: "Base",
                  homeScore: 101.3,
                  pointDiff: 6.5,
                },
                {
                  awayDefense: "ManToMan",
                  awayScore: 92.1,
                  homeOffense: "Motion",
                  homeScore: 104.7,
                  pointDiff: 12.6,
                },
              ],
              [
                {
                  awayDefense: "23Zone",
                  awayScore: 96.4,
                  homeOffense: "Base",
                  homeScore: 99.3,
                  pointDiff: 2.9,
                },
                {
                  awayDefense: "23Zone",
                  awayScore: null,
                  homeOffense: "Motion",
                  homeScore: null,
                  pointDiff: null,
                },
              ],
            ],
          },
        };
      },
      resolveConnectedInput: async () => {
        throw new Error(
          "resolveConnectedInput should not be called for manual jobs",
        );
      },
      updatePredictionJob: async (_env, input) => {
        updates.push(input as Record<string, unknown>);
      },
    },
  );

  assert.equal(endpointCalls, 1);
  assert.equal(updates[0]?.status, "RESOLVING_INPUT");
  assert.equal(updates[1]?.status, "INVOKING_MODEL");
  assert.equal(updates[2]?.status, "SUCCEEDED");
  const successfulUpdate = updates[2];
  assert.ok(successfulUpdate);
  assert.deepStrictEqual(successfulUpdate.result, {
    awayScore: 94.8,
    homeScore: 101.3,
    modelVersion: "bundle-v1",
    pointDiff: 6.5,
    tacticsGrid: {
      offenses: ["Base", "Motion"],
      defenses: ["ManToMan", "23Zone"],
      cells: [
        [
          {
            awayDefense: "ManToMan",
            awayScore: 94.8,
            homeOffense: "Base",
            homeScore: 101.3,
            pointDiff: 6.5,
          },
          {
            awayDefense: "ManToMan",
            awayScore: 92.1,
            homeOffense: "Motion",
            homeScore: 104.7,
            pointDiff: 12.6,
          },
        ],
        [
          {
            awayDefense: "23Zone",
            awayScore: 96.4,
            homeOffense: "Base",
            homeScore: 99.3,
            pointDiff: 2.9,
          },
          {
            awayDefense: "23Zone",
            awayScore: null,
            homeOffense: "Motion",
            homeScore: null,
            pointDiff: null,
          },
        ],
      ],
    },
  });
  assert.equal(successfulUpdate.modelVersion, "bundle-v1");
});
