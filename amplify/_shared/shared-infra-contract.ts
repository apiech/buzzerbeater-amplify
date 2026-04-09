const prodEnvironmentNames = new Set(["main", "master", "prod"]);

export type SharedInfraBindings = {
  activeTrackedTeamsTableName: string;
  matchCatalogTableName: string;
  matchProcessingStateMachineArn: string;
  matchStoreBucketName: string;
  opponentForecastEndpointName: string | null;
  playerSkillSnapshotTableName: string;
  predictionEndpointName: string;
  teamHighlightsScanStateMachineArn: string;
  teamHighlightsStatusTableName: string;
  teamMatchProjectionTableName: string;
  teamMomentsTableName: string;
};

export type SharedInfraParameterPaths = {
  [Key in keyof SharedInfraBindings]: string;
};

export type BbConnectionSecretParameterPaths = {
  fingerprint: string;
  secret: string;
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
    matchProcessingStateMachineArn: `${basePath}/match-processing-state-machine-arn`,
    matchStoreBucketName: `${basePath}/match-store-bucket-name`,
    opponentForecastEndpointName: `${basePath}/opponent-forecast-endpoint-name`,
    playerSkillSnapshotTableName: `${basePath}/player-skill-snapshot-table-name`,
    predictionEndpointName: `${basePath}/prediction-endpoint-name`,
    teamHighlightsScanStateMachineArn: `${basePath}/team-highlights-scan-state-machine-arn`,
    teamHighlightsStatusTableName: `${basePath}/team-highlights-status-table-name`,
    teamMatchProjectionTableName: `${basePath}/team-match-projection-table-name`,
    teamMomentsTableName: `${basePath}/team-moments-table-name`,
  };
}

export function buildBbConnectionSecretParameterPaths(
  environmentName: string,
): BbConnectionSecretParameterPaths {
  const normalizedEnvironment = normalizeEnvironmentName(environmentName);
  const basePath = `/buzzerbeater/ml-data-infra/${normalizedEnvironment}`;

  return {
    fingerprint: `${basePath}/bb-connection-encryption-secret-fingerprint`,
    secret: `${basePath}/bb-connection-encryption-secret`,
  };
}
