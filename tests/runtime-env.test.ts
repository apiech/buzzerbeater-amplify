import assert from "node:assert/strict";
import test from "node:test";

import { __testing as activeTrackedTeamsTesting } from "../amplify/data/_backend/active-tracked-teams";
import { __testing as canonicalPlayerSnapshotsTesting } from "../amplify/data/_backend/canonical-player-snapshots";
import { getEncryptionSecret } from "../amplify/data/_backend/encryption";
import { __testing as matchStoreTesting } from "../amplify/data/_backend/match-store";
import { __testing as teamHighlightsTesting } from "../amplify/data/_backend/team-highlights";

test("runtime env resolvers read required values from passed env objects", () => {
  assert.equal(
    getEncryptionSecret({ BB_CONNECTION_ENCRYPTION_SECRET: "secret" }),
    "secret",
  );
  assert.equal(
    activeTrackedTeamsTesting.resolveActiveTrackedTeamsTableName({
      ACTIVE_TRACKED_TEAMS_TABLE_NAME: "active-teams",
    }),
    "active-teams",
  );
  assert.equal(
    canonicalPlayerSnapshotsTesting.resolvePlayerSkillSnapshotTableName({
      PLAYER_SKILL_SNAPSHOT_TABLE_NAME: "player-snapshots",
    }),
    "player-snapshots",
  );
  assert.equal(
    teamHighlightsTesting.resolveTeamMomentsTableName({
      TEAM_MOMENTS_TABLE_NAME: "team-moments",
    }),
    "team-moments",
  );
  assert.equal(
    teamHighlightsTesting.resolveTeamHighlightsStatusTableName({
      TEAM_HIGHLIGHTS_STATUS_TABLE_NAME: "team-highlights-status",
    }),
    "team-highlights-status",
  );
  assert.deepEqual(
    matchStoreTesting.resolveMatchStoreEnv({
      MATCH_STORE_BUCKET_NAME: "match-store-bucket",
      MATCH_CATALOG_TABLE_NAME: "match-catalog",
      TEAM_MATCH_PROJECTION_TABLE_NAME: "team-match-projections",
    }),
    {
      bucketName: "match-store-bucket",
      catalogTableName: "match-catalog",
      projectionTableName: "team-match-projections",
    },
  );
});

test("runtime env resolvers throw when required values are missing", () => {
  assert.throws(
    () => getEncryptionSecret({}),
    /BB_CONNECTION_ENCRYPTION_SECRET is not configured/,
  );
  assert.throws(
    () => activeTrackedTeamsTesting.resolveActiveTrackedTeamsTableName({}),
    /ACTIVE_TRACKED_TEAMS_TABLE_NAME is not configured/,
  );
  assert.throws(
    () => canonicalPlayerSnapshotsTesting.resolvePlayerSkillSnapshotTableName({}),
    /PLAYER_SKILL_SNAPSHOT_TABLE_NAME is not configured/,
  );
  assert.throws(
    () => teamHighlightsTesting.resolveTeamMomentsTableName({}),
    /TEAM_MOMENTS_TABLE_NAME is not configured/,
  );
  assert.throws(
    () => teamHighlightsTesting.resolveTeamHighlightsStatusTableName({}),
    /TEAM_HIGHLIGHTS_STATUS_TABLE_NAME is not configured/,
  );
  assert.throws(
    () => matchStoreTesting.resolveMatchStoreEnv({}),
    /Match store infrastructure environment variables are not configured/,
  );
});
