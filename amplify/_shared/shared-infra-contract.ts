const prodEnvironmentNames = new Set(["main", "master", "prod"]);

export type SharedInfraBindings = {
  activeTrackedTeamsTableName: string;
  matchCatalogTableName: string;
  matchStoreBucketName: string;
  playerSkillSnapshotTableName: string;
  predictionEndpointName: string;
  teamHighlightsScanQueueUrl: string;
  teamHighlightsStatusTableName: string;
  teamMatchProjectionTableName: string;
  teamMomentsTableName: string;
};

export type SharedInfraParameterPaths = {
  [Key in keyof SharedInfraBindings]: string;
};

export function normalizeEnvironmentName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("Environment name could not be resolved.");
  }

  return normalized;
}

export function branchToEnvironmentName(branchName: string): string {
  const normalizedBranch = normalizeEnvironmentName(branchName);
  return prodEnvironmentNames.has(normalizedBranch) ? "prod" : normalizedBranch;
}

export function buildSharedInfraParameterPaths(
  environmentName: string,
): SharedInfraParameterPaths {
  const normalizedEnvironment = normalizeEnvironmentName(environmentName);
  const basePath = `/buzzerbeater/ml-data-infra/${normalizedEnvironment}`;

  return {
    activeTrackedTeamsTableName: `${basePath}/active-tracked-teams-table-name`,
    matchCatalogTableName: `${basePath}/match-catalog-table-name`,
    matchStoreBucketName: `${basePath}/match-store-bucket-name`,
    playerSkillSnapshotTableName: `${basePath}/player-skill-snapshot-table-name`,
    predictionEndpointName: `${basePath}/prediction-endpoint-name`,
    teamHighlightsScanQueueUrl: `${basePath}/team-highlights-scan-queue-url`,
    teamHighlightsStatusTableName: `${basePath}/team-highlights-status-table-name`,
    teamMatchProjectionTableName: `${basePath}/team-match-projection-table-name`,
    teamMomentsTableName: `${basePath}/team-moments-table-name`,
  };
}
