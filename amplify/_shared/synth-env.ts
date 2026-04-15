import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { RemovalPolicy } from "aws-cdk-lib";

import { getParametersByName } from "./aws-cli-ssm.js";
import { resolvePublicAppOrigin } from "./public-app-origin.js";
import {
  branchToEnvironmentName,
  buildSharedInfraParameterPaths,
  normalizeEnvironmentName,
  type SharedInfraBindings,
} from "./shared-infra-contract.js";
import {
  normalizeSandboxIdentifier,
  sandboxIdentifierEnvName,
} from "../../scripts/shared-infra-bootstrap.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const amplifyRoot = join(currentDir, "..", "..");
const localEnvFilePath = join(amplifyRoot, ".env");
const optionalSharedInfraBindingKeys = new Set<keyof SharedInfraBindings>([
  "opponentForecastEndpointName",
]);

let localEnvLoaded = false;
let cachedSharedInfraBindings: {
  environmentName: string;
  region: string;
  value: SharedInfraBindings;
} | null = null;

type AwsCliRuntime = {
  execAwsJson: (args: string[]) => unknown;
  fileExists: (filePath: string) => boolean;
  loadEnvFile: (filePath: string) => void;
  userName: () => string;
};

export type BillingSynthConfig = {
  appBaseUrl: string;
  commercialModeEnabled: boolean;
  defaultPlanId: string | null;
  lifetimePriceId: string | null;
  lifetimePurchaseOfferEnabled: boolean;
  premiumPriceId: string | null;
  premiumSubscriptionOfferEnabled: boolean;
};

export type CostVisibilitySynthConfig = {
  alertEmails?: string;
  alertSmsNumbers?: string;
  enabled: boolean;
};

export type FeedbackNotificationsSynthConfig = {
  alertEmails?: string;
};

export type MaintenanceControlPlaneSynthConfig = {
  environmentName: string;
  parameterName: string;
};

export type GameDayRecapSynthConfig = {
  defaultModelId: string;
  premiumModelId: string | null;
};

export type OperationalRetentionSynthConfig = {
  syncRunRetentionDays: string;
};

export type HostedBranchConfig = {
  appId: string;
  branchName: string;
  environmentName: string;
  region: string;
};

export const __testing = {
  createDefaultRuntime,
  resetCachedState,
  readSharedInfraBindingsFromRuntime,
  resolveAppResourceRemovalPolicy,
  resolveHostedBranchConfig,
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

  const commercialModeEnabled = resolveCommercialModeEnabled(process.env);
  const premiumSubscriptionOfferEnabled = commercialModeEnabled
    ? resolveBillingOfferEnabled(
        process.env,
        "BILLING_ENABLE_PREMIUM_SUBSCRIPTION",
        true,
      )
    : false;
  const lifetimePurchaseOfferEnabled = commercialModeEnabled
    ? resolveBillingOfferEnabled(
        process.env,
        "BILLING_ENABLE_LIFETIME_PURCHASE",
        false,
      )
    : false;

  return {
    appBaseUrl: resolvePublicAppOrigin(process.env, {
      errorMessage: "APP_BASE_URL must be configured for Stripe billing.",
    }),
    commercialModeEnabled,
    defaultPlanId: resolveBillingDefaultPlan(process.env),
    lifetimePriceId: lifetimePurchaseOfferEnabled
      ? resolveRequiredEnv(
          process.env,
          "STRIPE_LIFETIME_PRICE_ID",
          "STRIPE_LIFETIME_PRICE_ID must be set when lifetime purchases are enabled.",
        )
      : normalizeOptionalString(process.env.STRIPE_LIFETIME_PRICE_ID),
    lifetimePurchaseOfferEnabled,
    premiumPriceId: premiumSubscriptionOfferEnabled
      ? resolveRequiredEnv(
          process.env,
          "STRIPE_PREMIUM_PRICE_ID",
          "STRIPE_PREMIUM_PRICE_ID must be set when premium subscriptions are enabled.",
        )
      : normalizeOptionalString(process.env.STRIPE_PREMIUM_PRICE_ID),
    premiumSubscriptionOfferEnabled,
  };
}

export function resolveCostVisibilityConfig(): CostVisibilitySynthConfig {
  loadLocalSynthEnv();

  return {
    alertEmails:
      normalizeOptionalString(process.env.COST_ALERT_EMAILS) ?? undefined,
    alertSmsNumbers:
      normalizeOptionalString(process.env.COST_ALERT_SMS_NUMBERS) ?? undefined,
    enabled: parseBooleanEnv(process.env.ENABLE_COST_VISIBILITY),
  };
}

export function resolveFeedbackNotificationConfig(): FeedbackNotificationsSynthConfig {
  loadLocalSynthEnv();

  return {
    alertEmails:
      normalizeOptionalString(process.env.FEEDBACK_ALERT_EMAILS) ?? undefined,
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
      normalizeOptionalString(process.env.GAME_DAY_RECAP_MODEL_ID_PREMIUM) ??
      null,
  };
}

export function resolveOperationalRetentionConfig(): OperationalRetentionSynthConfig {
  loadLocalSynthEnv();

  return {
    syncRunRetentionDays:
      normalizeOptionalString(process.env.SYNC_RUN_RETENTION_DAYS) ?? "14",
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

  const sandboxIdentifier = normalizeOptionalString(
    env[sandboxIdentifierEnvName],
  );
  if (sandboxIdentifier) {
    return normalizeEnvironmentName(
      `sandbox-${normalizeSandboxIdentifier(sandboxIdentifier)}`,
    );
  }

  return normalizeEnvironmentName(
    `sandbox-${normalizeSandboxIdentifier(runtime.userName())}`,
  );
}

export function resolveMaintenanceControlPlaneConfig(
  env: Record<string, string | undefined> = process.env,
  runtime: Pick<AwsCliRuntime, "userName"> = createDefaultRuntime(),
): MaintenanceControlPlaneSynthConfig {
  loadLocalSynthEnv();

  const configuredEnvironment = normalizeOptionalString(
    env.MAINTENANCE_ENVIRONMENT_NAME,
  );
  if (configuredEnvironment) {
    return createMaintenanceControlPlaneConfig(
      normalizeEnvironmentName(configuredEnvironment),
    );
  }

  const sharedEnvironment = normalizeOptionalString(
    env.BB_SHARED_ENVIRONMENT_NAME,
  );
  if (sharedEnvironment) {
    return createMaintenanceControlPlaneConfig(
      normalizeEnvironmentName(sharedEnvironment),
    );
  }

  const branchName = normalizeOptionalString(env.AWS_BRANCH);
  if (branchName) {
    return createMaintenanceControlPlaneConfig(
      branchToEnvironmentName(branchName),
    );
  }

  const sandboxIdentifier = normalizeOptionalString(
    env[sandboxIdentifierEnvName],
  );
  if (sandboxIdentifier) {
    return createMaintenanceControlPlaneConfig(
      normalizeEnvironmentName(
        `sandbox-${normalizeSandboxIdentifier(sandboxIdentifier)}`,
      ),
    );
  }

  return createMaintenanceControlPlaneConfig(
    normalizeEnvironmentName(
      `sandbox-${normalizeSandboxIdentifier(runtime.userName())}`,
    ),
  );
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

  const bindings = readSharedInfraBindingsFromRuntime(
    environmentName,
    region,
    runtime,
  );
  cachedSharedInfraBindings = { environmentName, region, value: bindings };
  return bindings;
}

export function resolveAppResourceRemovalPolicy(): RemovalPolicy {
  return resolveSharedEnvironmentName() === "prod"
    ? RemovalPolicy.RETAIN
    : RemovalPolicy.DESTROY;
}

export function resolveHostedBranchConfig(
  env: Record<string, string | undefined> = process.env,
): HostedBranchConfig | null {
  loadLocalSynthEnv();

  const appId = normalizeOptionalString(env.AWS_APP_ID);
  const branchName = normalizeOptionalString(env.AWS_BRANCH);
  if (!appId || !branchName) {
    return null;
  }

  return {
    appId,
    branchName,
    environmentName: branchToEnvironmentName(branchName),
    region: resolveAwsRegion(env),
  };
}

function createMaintenanceControlPlaneConfig(
  environmentName: string,
): MaintenanceControlPlaneSynthConfig {
  return {
    environmentName,
    parameterName: `/buzzerbeater/site-control/${environmentName}/current`,
  };
}

function readSharedInfraBindingsFromRuntime(
  environmentName: string,
  region: string,
  runtime: AwsCliRuntime,
): SharedInfraBindings {
  const parameterPaths = buildSharedInfraParameterPaths(environmentName);
  const parameterEntries = Object.entries(parameterPaths) as Array<
    [keyof SharedInfraBindings, string]
  >;
  let parametersResponse: {
    Parameters?: Array<{ Name?: string; Value?: string }>;
  };
  try {
    parametersResponse = getParametersByName({
      execAwsJson: runtime.execAwsJson,
      names: Object.values(parameterPaths),
      region,
    }) as {
      Parameters?: Array<{ Name?: string; Value?: string }>;
    };
  } catch (error) {
    throw buildSharedInfraLookupError(environmentName, region, error);
  }

  const valuesByPath = new Map(
    (parametersResponse.Parameters ?? []).map((parameter) => [
      parameter.Name,
      parameter.Value,
    ]),
  );
  const missingParameterPaths = parameterEntries
    .filter(
      ([bindingKey, parameterPath]) =>
        !optionalSharedInfraBindingKeys.has(bindingKey) &&
        !valuesByPath.get(parameterPath),
    )
    .map(([, parameterPath]) => parameterPath);
  const missingOptionalParameterPaths = parameterEntries
    .filter(
      ([bindingKey, parameterPath]) =>
        optionalSharedInfraBindingKeys.has(bindingKey) &&
        !valuesByPath.get(parameterPath),
    )
    .map(([, parameterPath]) => parameterPath);
  if (missingOptionalParameterPaths.length > 0) {
    console.warn(
      [
        `Optional shared ML infra parameters are missing for environment '${environmentName}'.`,
        "Opponent forecast jobs will stay disabled until these parameters are published.",
        `Missing optional parameters: ${missingOptionalParameterPaths.join(", ")}`,
      ].join(" "),
    );
  }
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
    activeTrackedTeamsTableName: valuesByPath.get(
      parameterPaths.activeTrackedTeamsTableName,
    )!,
    matchCatalogTableName: valuesByPath.get(
      parameterPaths.matchCatalogTableName,
    )!,
    matchProcessingStateMachineArn: valuesByPath.get(
      parameterPaths.matchProcessingStateMachineArn,
    )!,
    matchStoreBucketName: valuesByPath.get(
      parameterPaths.matchStoreBucketName,
    )!,
    opponentForecastEndpointName:
      valuesByPath.get(parameterPaths.opponentForecastEndpointName) ?? null,
    playerSkillSnapshotTableName: valuesByPath.get(
      parameterPaths.playerSkillSnapshotTableName,
    )!,
    predictionEndpointName: valuesByPath.get(
      parameterPaths.predictionEndpointName,
    )!,
    teamHighlightsScanStateMachineArn: valuesByPath.get(
      parameterPaths.teamHighlightsScanStateMachineArn,
    )!,
    teamHighlightsStatusTableName: valuesByPath.get(
      parameterPaths.teamHighlightsStatusTableName,
    )!,
    teamMatchProjectionTableName: valuesByPath.get(
      parameterPaths.teamMatchProjectionTableName,
    )!,
    teamMomentsTableName: valuesByPath.get(
      parameterPaths.teamMomentsTableName,
    )!,
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

function buildSharedInfraLookupError(
  environmentName: string,
  region: string,
  error: unknown,
): Error {
  const cliError = extractAwsCliErrorMessage(error);
  const policyResource = `arn:aws:ssm:${region}:427377913956:parameter/buzzerbeater/ml-data-infra/*`;

  if (isSharedInfraAccessDenied(cliError)) {
    return new Error(
      [
        `Unable to read shared ML infra parameters for environment '${environmentName}' from SSM in ${region}.`,
        "The AWS principal running Amplify synth is missing shared-infra SSM read access.",
        "Hosted Amplify builds should grant ssm:GetParameter, ssm:GetParameters, and ssm:GetParametersByPath",
        `on ${policyResource}.`,
        `Original AWS CLI error: ${cliError}`,
      ].join(" "),
    );
  }

  return new Error(
    [
      `Unable to read shared ML infra parameters for environment '${environmentName}' from SSM in ${region}.`,
      `Original AWS CLI error: ${cliError}`,
    ].join(" "),
  );
}

function extractAwsCliErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr =
      "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "stderr" in error && Buffer.isBuffer(error.stderr)
          ? error.stderr.toString("utf8")
          : null;
    const message = stderr?.trim() || error.message.trim();
    return message || "Unknown AWS CLI failure.";
  }

  return typeof error === "string" && error.trim()
    ? error.trim()
    : "Unknown AWS CLI failure.";
}

function isSharedInfraAccessDenied(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("accessdenied") && normalized.includes("getparameters")
  );
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

function resolveCommercialModeEnabled(
  env: Record<string, string | undefined>,
): boolean {
  if (!Object.hasOwn(env, "COMMERCIAL_MODE_ENABLED")) {
    return true;
  }

  return parseBooleanEnv(env.COMMERCIAL_MODE_ENABLED);
}

function resolveBillingDefaultPlan(
  env: Record<string, string | undefined>,
): string | null {
  if (!resolveCommercialModeEnabled(env)) {
    return null;
  }

  if (Object.hasOwn(env, "BILLING_DEFAULT_PLAN")) {
    return normalizeOptionalString(env.BILLING_DEFAULT_PLAN) ?? null;
  }

  return resolveSharedEnvironmentName(env) === "prod" ? null : "premium";
}

function resolveBillingOfferEnabled(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: boolean,
): boolean {
  if (!Object.hasOwn(env, name)) {
    return defaultValue;
  }

  return parseBooleanEnv(env[name]);
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
