import assert from "node:assert/strict";
import test from "node:test";

import { __testing as matchStoreIntegrationTesting } from "../amplify/_backend/match-store-integration";

test("external match-store config ignores generated env in local mode", () => {
  assert.equal(
    matchStoreIntegrationTesting.resolveExternalMatchStoreConfig({
      MATCH_DATA_PLANE_SOURCE: "local",
      MATCH_STORE_BUCKET_NAME: "bucket",
      MATCH_CATALOG_TABLE_NAME: "catalog",
      TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
      ACTIVE_TRACKED_TEAMS_TABLE_NAME: "active",
      PLAYER_SKILL_SNAPSHOT_TABLE_NAME: "snapshots",
      TEAM_MOMENTS_TABLE_NAME: "moments",
      TEAM_HIGHLIGHTS_STATUS_TABLE_NAME: "status",
      TEAM_HIGHLIGHTS_SCAN_QUEUE_URL: "https://queue",
    }),
    null,
  );
});

test("external match-store config resolves imported resources in external mode", () => {
  assert.deepEqual(
    matchStoreIntegrationTesting.resolveExternalMatchStoreConfig({
      MATCH_DATA_PLANE_SOURCE: "external",
      MATCH_STORE_BUCKET_NAME: "bucket",
      MATCH_CATALOG_TABLE_NAME: "catalog",
      TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
      ACTIVE_TRACKED_TEAMS_TABLE_NAME: "active",
      PLAYER_SKILL_SNAPSHOT_TABLE_NAME: "snapshots",
      TEAM_MOMENTS_TABLE_NAME: "moments",
      TEAM_HIGHLIGHTS_STATUS_TABLE_NAME: "status",
      TEAM_HIGHLIGHTS_SCAN_QUEUE_URL: "https://queue",
    }),
    {
      activeTrackedTeamsTableName: "active",
      bucketName: "bucket",
      catalogTableName: "catalog",
      playerSkillSnapshotTableName: "snapshots",
      projectionTableName: "projection",
      teamHighlightsScanQueueUrl: "https://queue",
      teamHighlightsStatusTableName: "status",
      teamMomentsTableName: "moments",
    },
  );
});

test("external match-store config points users to the sync workflow when generated env is missing", () => {
  assert.throws(
    () =>
      matchStoreIntegrationTesting.resolveExternalMatchStoreConfig({
        MATCH_DATA_PLANE_SOURCE: "external",
      }),
    /npm run sync:match-data-plane/,
  );
  assert.throws(
    () =>
      matchStoreIntegrationTesting.resolveExternalMatchStoreConfig({
        MATCH_DATA_PLANE_SOURCE: "external",
      }),
    /\.env\.match-data-plane/,
  );
});
