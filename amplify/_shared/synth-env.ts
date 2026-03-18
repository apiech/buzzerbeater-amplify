import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { RemovalPolicy } from "aws-cdk-lib";

import {
  resolvePublicAppOrigin,
} from "./public-app-origin.js";
import {
  branchToEnvironmentName,
  buildSharedInfraParameterPaths,
  normalizeEnvironmentName,
  type SharedInfraBindings,
} from "./shared-infra-contract.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const amplifyRoot = join(currentDir, "..", "..");
const localEnvFilePath = join(amplifyRoot, ".env");

let localEnvLoaded = false;
let cachedSharedInfraBindings:
  | { environmentName: string; region: string; value: SharedInfraBindings }
  | null = null;

type AwsCliRuntime = {
  execAwsJson: (args: string[]) => unknown;
  fileExists: (filePath: string) => boolean;
  loadEnvFile: (filePath: string) => void;
  userName: () => string;
};

export type BillingSynthConfig = {
  appBaseUrl: string;
  defaultPlanId: string | null;
  premiumPriceId: string;
};

export type CostVisibilitySynthConfig = {
  alertEmails?: string;
  alertSmsNumbers?: string;
  enabled: boolean;
};

export type GameDayRecapSynthConfig = {
  defaultModelId: string;
  premiumModelId: string | null;
};

export type OperationalRetentionSynthConfig = {
  predictionJobRetentionDays: string;
  syncRunRetentionDays: string;
};

export type RefreshJobsSynthConfig = {
  dedupeByTeam: string;
  maxUsersPerRun: string;
  staleAfterHours: string;
};

export const __testing = {
  createDefaultRuntime,
  resetCachedState,
  readSharedInfraBindingsFromRuntime,
  resolveAppResourceRemovalPolicy,
  resolveSharedEnvironmentName,
};

export function loadLocalSynthEnv(
  runtime: AwsCliRuntime = createDefaultRuntime(),
): void {
  if (localEnvLoaded) {
    return;
  }

  if (runtime.fileExists(localEnvFilePath)) {
    runtime.loadEnvFile(localEnvFilePath);
  }

  localEnvLoaded = true;
}

export function resolveAuthAppOrigin(
  runtime: AwsCliRuntime = createDefaultRuntime(),
): string {
  loadLocalSynthEnv(runtime);

  return resolvePublicAppOrigin(process.env, {
    errorMessage: "APP_BASE_URL must be configured for auth callback URLs.",
  });
}

export function resolveBillingConfig(): BillingSynthConfig {
  loadLocalSynthEnv();

  return {
    appBaseUrl: resolvePublicAppOrigin(process.env, {
      errorMessage: "APP_BASE_URL must be configured for Stripe billing.",
    }),
    defaultPlanId: resolveBillingDefaultPlan(process.env),
    premiumPriceId: resolveRequiredEnv(
      process.env,
      "STRIPE_PREMIUM_PRICE_ID",
      "STRIPE_PREMIUM_PRICE_ID must be set for Stripe billing.",
    ),
  };
}

export function resolveCostVisibilityConfig(): CostVisibilitySynthConfig {
  loadLocalSynthEnv();

  return {
    alertEmails: normalizeOptionalString(process.env.COST_ALERT_EMAILS) ?? undefined,
    alertSmsNumbers:
      normalizeOptionalString(process.env.COST_ALERT_SMS_NUMBERS) ?? undefined,
    enabled: parseBooleanEnv(process.env.ENABLE_COST_VISIBILITY),
  };
}

export function resolveGameDayRecapConfig(): GameDayRecapSynthConfig {
  loadLocalSynthEnv();

  return {
    defaultModelId: resolveRequiredEnv(
      process.env,
      "GAME_DAY_RECAP_MODEL_ID",
      "GAME_DAY_RECAP_MODEL_ID must be set for recap generation.",
    ),
    premiumModelId:
      normalizeOptionalString(process.env.GAME_DAY_RECAP_MODEL_ID_PREMIUM) ?? null,
  };
}

export function resolveOperationalRetentionConfig(): OperationalRetentionSynthConfig {
  loadLocalSynthEnv();

  return {
    predictionJobRetentionDays:
      normalizeOptionalString(process.env.PREDICTION_JOB_RETENTION_DAYS) ?? "30",
    syncRunRetentionDays:
      normalizeOptionalString(process.env.SYNC_RUN_RETENTION_DAYS) ?? "14",
  };
}

export function resolveRefreshJobsConfig(): RefreshJobsSynthConfig {
  loadLocalSynthEnv();

  return {
    dedupeByTeam:
      normalizeOptionalString(process.env.WORKSPACE_REFRESH_DEDUPE_BY_TEAM) ??
      "false",
    maxUsersPerRun:
      normalizeOptionalString(process.env.WORKSPACE_REFRESH_MAX_USERS_PER_RUN) ??
      "50",
    staleAfterHours:
      normalizeOptionalString(process.env.WORKSPACE_REFRESH_STALE_AFTER_HOURS) ??
      "24",
  };
}

export function resolveSharedEnvironmentName(
  env: Record<string, string | undefined> = process.env,
  runtime: Pick<AwsCliRuntime, "userName"> = createDefaultRuntime(),
): string {
  loadLocalSynthEnv();

  const configuredEnvironment = normalizeOptionalString(
    env.BB_SHARED_ENVIRONMENT_NAME,
  );
  if (configuredEnvironment) {
    return normalizeEnvironmentName(configuredEnvironment);
  }

  const branchName = normalizeOptionalString(env.AWS_BRANCH);
  if (branchName) {
    return branchToEnvironmentName(branchName);
  }

  return normalizeEnvironmentName(`sandbox-${runtime.userName()}`);
}

export function resolveSharedInfraBindings(
  runtime: AwsCliRuntime = createDefaultRuntime(),
): SharedInfraBindings {
  loadLocalSynthEnv(runtime);

  const environmentName = resolveSharedEnvironmentName(process.env, runtime);
  const region = resolveAwsRegion(process.env);
  if (
    cachedSharedInfraBindings &&
    cachedSharedInfraBindings.environmentName === environmentName &&
    cachedSharedInfraBindings.region === region
  ) {
    return cachedSharedInfraBindings.value;
  }

  const bindings = readSharedInfraBindingsFromRuntime(environmentName, region, runtime);
  cachedSharedInfraBindings = { environmentName, region, value: bindings };
  return bindings;
}

export function resolveAppResourceRemovalPolicy(): RemovalPolicy {
  return resolveSharedEnvironmentName() === "prod"
    ? RemovalPolicy.RETAIN
    : RemovalPolicy.DESTROY;
}

function readSharedInfraBindingsFromRuntime(
  environmentName: string,
  region: string,
  runtime: AwsCliRuntime,
): SharedInfraBindings {
  const parameterPaths = buildSharedInfraParameterPaths(environmentName);
  const parametersResponse = runtime.execAwsJson([
    "ssm",
    "get-parameters",
    "--with-decryption",
    "--region",
    region,
    "--output",
    "json",
    "--names",
    ...Object.values(parameterPaths),
  ]) as {
    Parameters?: Array<{ Name?: string; Value?: string }>;
  };

  const valuesByPath = new Map(
    (parametersResponse.Parameters ?? []).map((parameter) => [
      parameter.Name,
      parameter.Value,
    ]),
  );
  const missingParameterPaths = Object.values(parameterPaths).filter(
    (parameterPath) => !valuesByPath.get(parameterPath),
  );
  if (missingParameterPaths.length > 0) {
    throw new Error(
      [
        `Shared ML infra parameters are missing for environment '${environmentName}'.`,
        "Deploy the shared infrastructure first.",
        "For local sandbox workflows, use `npm run sandbox` so the wrapper can bootstrap shared infra before Amplify synth.",
        `Missing parameters: ${missingParameterPaths.join(", ")}`,
      ].join(" "),
    );
  }

  return {
    activeTrackedTeamsTableName:
      valuesByPath.get(parameterPaths.activeTrackedTeamsTableName)!,
    matchCatalogTableName: valuesByPath.get(parameterPaths.matchCatalogTableName)!,
    matchStoreBucketName: valuesByPath.get(parameterPaths.matchStoreBucketName)!,
    playerSkillSnapshotTableName:
      valuesByPath.get(parameterPaths.playerSkillSnapshotTableName)!,
    predictionEndpointName: valuesByPath.get(parameterPaths.predictionEndpointName)!,
    teamHighlightsScanQueueUrl:
      valuesByPath.get(parameterPaths.teamHighlightsScanQueueUrl)!,
    teamHighlightsStatusTableName:
      valuesByPath.get(parameterPaths.teamHighlightsStatusTableName)!,
    teamMatchProjectionTableName:
      valuesByPath.get(parameterPaths.teamMatchProjectionTableName)!,
    teamMomentsTableName: valuesByPath.get(parameterPaths.teamMomentsTableName)!,
  };
}

function createDefaultRuntime(): AwsCliRuntime {
  return {
    execAwsJson: (args) =>
      JSON.parse(
        execFileSync("aws", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    fileExists: existsSync,
    loadEnvFile: (filePath) => {
      process.loadEnvFile(filePath);
    },
    userName: () => os.userInfo().username || "local",
  };
}

function resetCachedState(): void {
  cachedSharedInfraBindings = null;
  localEnvLoaded = false;
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveAwsRegion(env: Record<string, string | undefined>): string {
  return (
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION) ??
    "us-east-1"
  );
}

function resolveBillingDefaultPlan(
  env: Record<string, string | undefined>,
): string | null {
  if (Object.hasOwn(env, "BILLING_DEFAULT_PLAN")) {
    return normalizeOptionalString(env.BILLING_DEFAULT_PLAN) ?? null;
  }

  return resolveSharedEnvironmentName(env) === "prod" ? null : "premium";
}

function resolveRequiredEnv(
  env: Record<string, string | undefined>,
  name: string,
  errorMessage: string,
): string {
  const value = normalizeOptionalString(env[name]);
  if (!value) {
    throw new Error(errorMessage);
  }

  return value;
}
