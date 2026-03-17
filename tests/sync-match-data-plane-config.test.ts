import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMatchDataPlaneEnvFromOutputs,
  renderMatchDataPlaneEnvFile,
  syncMatchDataPlaneConfig,
} from "../scripts/sync-match-data-plane-config.mjs";

test("extractMatchDataPlaneEnvFromOutputs maps CloudFormation outputs to env vars", () => {
  const envValues = extractMatchDataPlaneEnvFromOutputs([
    { OutputKey: "MatchStoreBucketName", OutputValue: "bucket" },
    { OutputKey: "MatchCatalogTableName", OutputValue: "catalog" },
    { OutputKey: "TeamMatchProjectionTableName", OutputValue: "projection" },
    { OutputKey: "ActiveTrackedTeamsTableName", OutputValue: "active" },
    { OutputKey: "PlayerSkillSnapshotTableName", OutputValue: "snapshots" },
    { OutputKey: "TeamMomentsTableName", OutputValue: "moments" },
    { OutputKey: "TeamHighlightsStatusTableName", OutputValue: "status" },
    { OutputKey: "TeamHighlightsScanQueueUrl", OutputValue: "https://queue" },
  ]);

  assert.deepEqual(envValues, {
    ACTIVE_TRACKED_TEAMS_TABLE_NAME: "active",
    MATCH_CATALOG_TABLE_NAME: "catalog",
    MATCH_STORE_BUCKET_NAME: "bucket",
    PLAYER_SKILL_SNAPSHOT_TABLE_NAME: "snapshots",
    TEAM_HIGHLIGHTS_SCAN_QUEUE_URL: "https://queue",
    TEAM_HIGHLIGHTS_STATUS_TABLE_NAME: "status",
    TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
    TEAM_MOMENTS_TABLE_NAME: "moments",
  });
});

test("extractMatchDataPlaneEnvFromOutputs throws when required outputs are missing", () => {
  assert.throws(
    () =>
      extractMatchDataPlaneEnvFromOutputs([
        { OutputKey: "MatchStoreBucketName", OutputValue: "bucket" },
      ]),
    /MatchDataPlane stack outputs are missing required values:/,
  );
});

test("renderMatchDataPlaneEnvFile writes deterministic generated env contents", () => {
  assert.match(
    renderMatchDataPlaneEnvFile({
      ACTIVE_TRACKED_TEAMS_TABLE_NAME: "active",
      MATCH_CATALOG_TABLE_NAME: "catalog",
      MATCH_STORE_BUCKET_NAME: "bucket",
      PLAYER_SKILL_SNAPSHOT_TABLE_NAME: "snapshots",
      TEAM_HIGHLIGHTS_SCAN_QUEUE_URL: "https://queue",
      TEAM_HIGHLIGHTS_STATUS_TABLE_NAME: "status",
      TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
      TEAM_MOMENTS_TABLE_NAME: "moments",
    }),
    /MATCH_STORE_BUCKET_NAME=bucket/,
  );
});

test("syncMatchDataPlaneConfig uses the default MatchDataPlane stack name", async () => {
  const writes: Array<{ contents: string; filePath: string }> = [];
  const result = await syncMatchDataPlaneConfig({
    projectRootPath: "/tmp/project",
    runtime: {
      describeStackOutputs: async ({ stackName }: { stackName: string }) => {
        assert.equal(stackName, "MatchDataPlane");
        return [
          { OutputKey: "MatchStoreBucketName", OutputValue: "bucket" },
          { OutputKey: "MatchCatalogTableName", OutputValue: "catalog" },
          {
            OutputKey: "TeamMatchProjectionTableName",
            OutputValue: "projection",
          },
          { OutputKey: "ActiveTrackedTeamsTableName", OutputValue: "active" },
          {
            OutputKey: "PlayerSkillSnapshotTableName",
            OutputValue: "snapshots",
          },
          { OutputKey: "TeamMomentsTableName", OutputValue: "moments" },
          { OutputKey: "TeamHighlightsStatusTableName", OutputValue: "status" },
          {
            OutputKey: "TeamHighlightsScanQueueUrl",
            OutputValue: "https://queue",
          },
        ];
      },
      env: {
        NODE_ENV: "test",
        MATCH_DATA_PLANE_SOURCE: "external",
      },
      writeFile: async (filePath: string, contents: string) => {
        writes.push({ contents, filePath });
      },
    },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.stackName, "MatchDataPlane");
  assert.equal(writes[0]?.filePath, "/tmp/project/.env.match-data-plane");
  const firstWrite = writes[0];
  assert.ok(firstWrite);
  assert.match(
    firstWrite.contents,
    /TEAM_HIGHLIGHTS_SCAN_QUEUE_URL=https:\/\/queue/,
  );
});

test("syncMatchDataPlaneConfig honors an explicit stack name override", async () => {
  const result = await syncMatchDataPlaneConfig({
    projectRootPath: "/tmp/project",
    runtime: {
      describeStackOutputs: async ({ stackName }: { stackName: string }) => {
        assert.equal(stackName, "CustomDataPlane");
        return [
          { OutputKey: "MatchStoreBucketName", OutputValue: "bucket" },
          { OutputKey: "MatchCatalogTableName", OutputValue: "catalog" },
          {
            OutputKey: "TeamMatchProjectionTableName",
            OutputValue: "projection",
          },
          { OutputKey: "ActiveTrackedTeamsTableName", OutputValue: "active" },
          {
            OutputKey: "PlayerSkillSnapshotTableName",
            OutputValue: "snapshots",
          },
          { OutputKey: "TeamMomentsTableName", OutputValue: "moments" },
          { OutputKey: "TeamHighlightsStatusTableName", OutputValue: "status" },
          {
            OutputKey: "TeamHighlightsScanQueueUrl",
            OutputValue: "https://queue",
          },
        ];
      },
      env: {
        NODE_ENV: "test",
        MATCH_DATA_PLANE_SOURCE: "external",
        MATCH_DATA_PLANE_STACK_NAME: "CustomDataPlane",
      },
      writeFile: async () => undefined,
    },
  });

  assert.equal(result.stackName, "CustomDataPlane");
});
