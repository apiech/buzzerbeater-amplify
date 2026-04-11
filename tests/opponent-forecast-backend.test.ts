import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizeOpponentForecastResult,
  submitOpponentForecastJob,
} from "../amplify/data/_backend/opponent-forecast";
import { selectBoxscorePerspective } from "../amplify/data/_backend/neutral-boxscore";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const opponentForecastJobsSource = readFileSync(
  join(repoRoot, "amplify", "_backend", "opponent-forecast-jobs.ts"),
  "utf8",
);
const opponentForecastWorkerResourceSource = readFileSync(
  join(repoRoot, "amplify", "opponent-forecast-worker", "resource.ts"),
  "utf8",
);

function expectPresent<T>(value: T | null | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}

test("normalizeOpponentForecastResult fills required forecast fields", () => {
  const result = normalizeOpponentForecastResult({
    analogGames: [
      {
        matchId: "m-1",
        opponentTeamName: "Analog Club",
        similarity: 0.82,
      },
    ],
    confidence: 0.71,
    coverage: {
      analogGamesConsidered: 12,
      headToHeadGamesConsidered: 3,
      recentGamesConsidered: 8,
      rosterPlayersConsidered: 10,
      sampleStrategy: "CURRENT_SEASON_SERIOUS_PLUS_SUPPORTING",
      seriousGamesConsidered: 5,
      supportingGamesConsidered: 3,
    },
    featureSignals: [
      {
        key: "must-win",
        label: "Must-win pressure",
        value: "High",
      },
    ],
    generatedAt: "2026-03-19T00:00:00.000Z",
    modelVersion: "forecast-v1",
    topScenarios: [
      {
        defense: "23Zone",
        effortChoice: "Normal",
        evidence: ["Recent league usage", "Healthy backcourt"],
        gdpFocus: "Balanced.hit",
        gdpPace: "Normal.hit",
        label: "Primary",
        offense: "Motion",
        probability: 0.54,
        rotation: [
          {
            expectedMinutes: 34,
            fullName: "Bench Guard",
          },
        ],
        scenarioId: "scenario-1",
        starters: [
          {
            bestPosition: "PG",
            expectedMinutes: 36,
            fullName: "Lead Guard",
            starterProbability: 0.91,
          },
        ],
      },
    ],
  });

  assert.equal(result.modelVersion, "forecast-v1");
  assert.equal(result.coverage.recentGamesConsidered, 8);
  assert.equal(result.coverage.seriousGamesConsidered, 5);
  assert.equal(result.coverage.supportingGamesConsidered, 3);
  assert.equal(
    result.coverage.sampleStrategy,
    "CURRENT_SEASON_SERIOUS_PLUS_SUPPORTING",
  );
  const scenario = expectPresent(result.topScenarios[0], "scenario missing");
  const starter = expectPresent(scenario.starters[0], "starter missing");
  const analog = expectPresent(result.analogGames[0], "analog missing");
  assert.equal(scenario.label, "Primary");
  assert.equal(starter.fullName, "Lead Guard");
  assert.equal(analog.matchId, "m-1");
});

test("submitOpponentForecastJob rejects free-plan users before queueing work", async () => {
  await assert.rejects(
    () =>
      submitOpponentForecastJob(
        {
          env: {},
          identity: { sub: "user-1" },
          stateMachineArn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:opponent-forecast",
          teamId: "200",
        },
        {
          createOpponentForecastJob: async () => {
            throw new Error("createOpponentForecastJob should not be called");
          },
          requireFeatureAccess: async () => {
            throw new Error(
              "Premium is required to use the opponent forecast engine.",
            );
          },
          startWorkflowExecution: async () => {
            throw new Error("startWorkflowExecution should not be called");
          },
          updateOpponentForecastJob: async () => {},
        },
      ),
    /premium is required/i,
  );
});

test("submitOpponentForecastJob queues work for premium users", async () => {
  let createdRecord: { status: string; teamId: string; userId: string } | null =
    null;
  let queuedMessage: Record<string, string> | null = null;

  const result = await submitOpponentForecastJob(
    {
      env: {},
      identity: { sub: "user-1" },
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:opponent-forecast",
      teamId: "200",
    },
    {
      createOpponentForecastJob: async (_env, input) => {
        createdRecord = input as {
          status: string;
          teamId: string;
          userId: string;
        };
        return {
          ...(input as Record<string, unknown>),
          createdAt: "2026-03-19T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        } as any;
      },
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async (_stateMachineArn, _executionName, message) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:opponent-forecast:job-1";
      },
      updateOpponentForecastJob: async () => {},
    },
  );

  assert.match(String(result.jobId), /^[0-9a-f-]{36}$/i);
  assert.equal(
    result.executionArn,
    "arn:aws:states:us-east-1:123456789012:execution:opponent-forecast:job-1",
  );
  const record = expectPresent<{
    status: string;
    teamId: string;
    userId: string;
  }>(createdRecord, "forecast job input missing");
  assert.equal(record.userId, "user-1");
  assert.equal(record.teamId, "200");
  assert.equal(record.status, "QUEUED");
  assert.deepStrictEqual(queuedMessage, {
    jobId: result.jobId,
    userId: "user-1",
  });
});

test("selectBoxscorePerspective resolves legacy teamId keys", () => {
  const perspective = selectBoxscorePerspective(
    {
      homeTeam: {
        teamId: "HOME",
        teamName: "Home Club",
      },
      awayTeam: {
        teamId: "AWAY",
        teamName: "Away Club",
      },
    },
    "HOME",
  );

  assert.equal(perspective.teamLocation, "HOME");
  assert.equal(perspective.team?.teamName, "Home Club");
  assert.equal(perspective.opponent?.teamName, "Away Club");
});

test("opponent forecast worker keeps workspace-refresh prerequisites without active tracked team wiring", () => {
  assert.match(
    opponentForecastWorkerResourceSource,
    /buildBbConnectionSecretFunctionEnvironment/,
  );
  assert.match(
    opponentForecastJobsSource,
    /PLAYER_SKILL_SNAPSHOT_TABLE_NAME/,
  );
  assert.match(
    opponentForecastJobsSource,
    /playerSkillSnapshotTable\.grantReadWriteData/,
  );
  assert.doesNotMatch(
    opponentForecastJobsSource,
    /ACTIVE_TRACKED_TEAMS_TABLE_NAME/,
  );
});
