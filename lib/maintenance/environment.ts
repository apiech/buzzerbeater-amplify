const prodEnvironmentNames = new Set(["main", "master", "prod"]);
const maintenanceParameterPrefix = "/buzzerbeater/site-control";

type Runtime = {
  userName(): string;
};

const defaultRuntime: Runtime = {
  userName: () => readMaintenanceRuntimeUserName(),
};

export function normalizeMaintenanceEnvironmentName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("Maintenance environment name could not be resolved.");
  }

  return normalized;
}

export function branchToMaintenanceEnvironmentName(branchName: string): string {
  const normalizedBranch = normalizeMaintenanceEnvironmentName(branchName);
  return prodEnvironmentNames.has(normalizedBranch) ? "prod" : normalizedBranch;
}

export function resolveMaintenanceEnvironmentName(
  env: Record<string, string | undefined> = readMaintenanceRuntimeEnv(),
  runtime: Runtime = defaultRuntime,
): string {
  const configuredEnvironment = normalizeOptionalString(
    env.MAINTENANCE_ENVIRONMENT_NAME,
  );
  if (configuredEnvironment) {
    return normalizeMaintenanceEnvironmentName(configuredEnvironment);
  }

  const sharedEnvironment = normalizeOptionalString(
    env.BB_SHARED_ENVIRONMENT_NAME,
  );
  if (sharedEnvironment) {
    return normalizeMaintenanceEnvironmentName(sharedEnvironment);
  }

  const branchName = normalizeOptionalString(env.AWS_BRANCH);
  if (branchName) {
    return branchToMaintenanceEnvironmentName(branchName);
  }

  const sandboxIdentifier = normalizeOptionalString(env.BB_SANDBOX_IDENTIFIER);
  if (sandboxIdentifier) {
    return normalizeMaintenanceEnvironmentName(`sandbox-${sandboxIdentifier}`);
  }

  return normalizeMaintenanceEnvironmentName(`sandbox-${runtime.userName()}`);
}

export function buildMaintenanceParameterName(environmentName: string): string {
  return `${maintenanceParameterPrefix}/${normalizeMaintenanceEnvironmentName(
    environmentName,
  )}/current`;
}

export function readMaintenanceRuntimeEnv(): Record<
  string,
  string | undefined
> {
  try {
    return ((process as NodeJS.Process | undefined)?.["env"] ?? {}) as Record<
      string,
      string | undefined
    >;
  } catch {
    return {};
  }
}

export function readMaintenanceRuntimeUserName(
  env: Record<string, string | undefined> = readMaintenanceRuntimeEnv(),
): string {
  return (
    normalizeOptionalString(env.USER) ??
    normalizeOptionalString(env.LOGNAME) ??
    "local"
  );
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
