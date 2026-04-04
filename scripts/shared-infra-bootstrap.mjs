import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");
const workspaceRoot = join(projectRoot, "..");
const sharedInfraRoot = join(workspaceRoot, "bb-shared-infra");
const sandboxManagementSubcommands = new Set(["delete", "secret", "seed"]);
const predictorEndpointParameterLeafName = "prediction-endpoint-name";
const defaultAwsRegion = "us-east-1";
export const sandboxIdentifierEnvName = "BB_SANDBOX_IDENTIFIER";
export const skipSandboxSharedInfraBootstrapEnvName =
  "BB_SKIP_SANDBOX_SHARED_INFRA_BOOTSTRAP";

export function shouldBootstrapSandboxSharedInfra(argv) {
  if (argv[0] !== "sandbox") {
    return false;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return false;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    return false;
  }

  return !sandboxManagementSubcommands.has(argv[1] ?? "");
}

export function normalizeSandboxIdentifier(value) {
  const normalized = `${value ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("Sandbox identifier could not be resolved.");
  }

  return normalized;
}

export function resolveSandboxIdentifier(
  argv,
  runtime = createDefaultRuntime(),
) {
  const explicitIdentifier = resolveExplicitSandboxIdentifier(argv);
  if (explicitIdentifier) {
    return explicitIdentifier;
  }

  const configuredIdentifier = normalizeOptionalString(
    runtime.env?.[sandboxIdentifierEnvName],
  );
  if (configuredIdentifier) {
    return normalizeSandboxIdentifier(configuredIdentifier);
  }

  return normalizeSandboxIdentifier(runtime.userName());
}

export function resolveSandboxEnvironmentName(
  argv,
  runtime = createDefaultRuntime(),
) {
  return `sandbox-${resolveSandboxIdentifier(argv, runtime)}`;
}

export function createSharedInfraBootstrapCommand(
  argv,
  runtime = createDefaultRuntime(),
) {
  const sandboxIdentifier = resolveSandboxIdentifier(argv, runtime);

  return {
    args: [
      "--prefix",
      sharedInfraRoot,
      "run",
      "deploy:ml-data-infra",
      "--",
      "--sandbox-identifier",
      sandboxIdentifier,
    ],
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    environmentName: `sandbox-${sandboxIdentifier}`,
    sandboxIdentifier,
  };
}

export function buildSandboxPredictorReleaseCommand(
  argv,
  runtime = createDefaultRuntime(),
) {
  const sandboxIdentifier = resolveSandboxIdentifier(argv, runtime);
  const commandParts = [
    "./scripts/matchup-predictor-release",
    "sandbox",
    "--identifier",
    sandboxIdentifier,
  ];
  commandParts.push(
    "--release-id",
    "<release-id>",
    "--artifact-prefix",
    "<absolute-artifact-stem>",
  );

  return {
    command: commandParts.join(" "),
    cwd: workspaceRoot,
    environmentName: `sandbox-${sandboxIdentifier}`,
    sandboxIdentifier,
  };
}

export function assertSandboxPredictorReady(
  argv,
  runtime = createDefaultRuntime(),
) {
  if (!shouldBootstrapSandboxSharedInfra(argv)) {
    return null;
  }

  const sandboxIdentifier = resolveSandboxIdentifier(argv, runtime);
  const environmentName = resolveSandboxEnvironmentName(argv, runtime);
  const region = resolveAwsRegion(runtime.env);
  const parameterName = buildPredictorEndpointParameterPath(environmentName);

  let parameterResponse;
  try {
    parameterResponse = runtime.execAwsJson([
      "ssm",
      "get-parameters",
      "--with-decryption",
      "--region",
      region,
      "--output",
      "json",
      "--names",
      parameterName,
    ]);
  } catch (_error) {
    throw createSandboxPredictorError(
      argv,
      runtime,
      `Unable to read the predictor endpoint contract for sandbox '${sandboxIdentifier}'.`,
    );
  }

  const endpointName = normalizeOptionalString(
    parameterResponse?.Parameters?.find?.(
      (parameter) => parameter?.Name === parameterName,
    )?.Value,
  );
  if (!endpointName) {
    throw createSandboxPredictorError(
      argv,
      runtime,
      [
        `Predictor endpoint is not deployed for sandbox '${sandboxIdentifier}'.`,
        `Missing SSM parameter: ${parameterName}.`,
      ].join(" "),
    );
  }

  let endpointResponse;
  try {
    endpointResponse = runtime.execAwsJson([
      "sagemaker",
      "describe-endpoint",
      "--region",
      region,
      "--output",
      "json",
      "--endpoint-name",
      endpointName,
    ]);
  } catch (_error) {
    throw createSandboxPredictorError(
      argv,
      runtime,
      [
        `Predictor endpoint '${endpointName}' for sandbox '${sandboxIdentifier}' is missing in SageMaker.`,
        "Release the predictor first.",
      ].join(" "),
    );
  }

  const endpointStatus = normalizeOptionalString(endpointResponse?.EndpointStatus);
  if (endpointStatus !== "InService") {
    throw createSandboxPredictorError(
      argv,
      runtime,
      [
        `Predictor endpoint '${endpointName}' for sandbox '${sandboxIdentifier}' is not ready.`,
        `Current status: ${endpointStatus ?? "unknown"}.`,
      ].join(" "),
    );
  }

  return {
    endpointName,
    environmentName,
    region,
    sandboxIdentifier,
  };
}

export function ensureResolvedSandboxIdentifierArgv(
  argv,
  runtime = createDefaultRuntime(),
) {
  if (argv[0] !== "sandbox") {
    return [...argv];
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return [...argv];
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    return [...argv];
  }

  const sandboxIdentifier = resolveSandboxIdentifier(argv, runtime);
  const nextArgv = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--identifier") {
      index += 1;
      continue;
    }
    if (argument?.startsWith("--identifier=")) {
      continue;
    }
    nextArgv.push(argument);
  }

  nextArgv.push("--identifier", sandboxIdentifier);
  return nextArgv;
}

export function bootstrapSandboxSharedInfra(
  argv,
  runtime = createDefaultRuntime(),
) {
  if (!shouldBootstrapSandboxSharedInfra(argv)) {
    return null;
  }

  if (normalizeOptionalString(runtime.env?.[skipSandboxSharedInfraBootstrapEnvName])) {
    return null;
  }

  if (!runtime.directoryExists(sharedInfraRoot)) {
    throw new Error(
      `Shared infra workspace is missing at ${sharedInfraRoot}.`,
    );
  }

  if (!runtime.env.BB_CONNECTION_ENCRYPTION_SECRET?.trim()) {
    throw new Error(
      [
        "BB_CONNECTION_ENCRYPTION_SECRET must be set before bootstrapping shared infra.",
        "Use the same value as the Amplify sandbox secret so bb-amplify and ML Data Infra can read the same encrypted credentials.",
      ].join(" "),
    );
  }

  const { args, command, environmentName, sandboxIdentifier } =
    createSharedInfraBootstrapCommand(argv, runtime);
  const childEnv = {
    ...runtime.env,
    BB_SHARED_ENVIRONMENT_NAME: environmentName,
  };
  const result = runtime.spawnSync(command, args, {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `Shared infra bootstrap failed for sandbox '${sandboxIdentifier}'.`,
    );
  }

  return {
    environmentName,
    sandboxIdentifier,
  };
}

function createDefaultRuntime() {
  return {
    directoryExists: existsSync,
    execAwsJson: (args) =>
      JSON.parse(
        execFileSync("aws", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    env: process.env,
    spawnSync,
    userName: () => os.userInfo().username || "local",
  };
}

function createSandboxPredictorError(argv, runtime, reason) {
  const releaseCommand = buildSandboxPredictorReleaseCommand(argv, runtime);
  return new Error(
    [
      reason,
      `From ${releaseCommand.cwd} run: ${releaseCommand.command}`,
    ].join(" "),
  );
}

function buildPredictorEndpointParameterPath(environmentName) {
  return `/buzzerbeater/ml-data-infra/${environmentName}/${predictorEndpointParameterLeafName}`;
}

function resolveExplicitSandboxIdentifier(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--identifier") {
      return normalizeSandboxIdentifier(argv[index + 1]);
    }
    if (argument?.startsWith("--identifier=")) {
      return normalizeSandboxIdentifier(argument.slice("--identifier=".length));
    }
  }

  return null;
}

function normalizeOptionalString(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function resolveAwsRegion(env) {
  return (
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION) ??
    defaultAwsRegion
  );
}
