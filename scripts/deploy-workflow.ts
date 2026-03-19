import { execFileSync, spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  type PathLike,
} from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildSharedInfraParameterPaths } from "../amplify/_shared/shared-infra-contract.js";
import {
  buildSandboxPredictorReleaseCommand,
  createSharedInfraBootstrapCommand,
  resolveSandboxEnvironmentName,
  resolveSandboxIdentifier,
  skipSandboxSharedInfraBootstrapEnvName,
} from "./shared-infra-bootstrap.mjs";
import {
  createPredictorTargetPin,
  defaultAwsRegion,
  expectedAwsAccount,
  inspectPredictorTargetPin,
  loadDeployWorkflowEnv,
  projectRoot,
  requiredSandboxAppEnvNames,
  resolvePredictorTargetPin,
  resolvePredictorTargetsFilePath,
  sandboxSecretName,
  type PredictorTargetName,
  writePredictorTargetPin,
  workspaceRoot,
} from "./deploy-runtime.js";
import { normalizeOptionalString } from "./project-env.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const ampxWithEnvScriptPath = join(currentDir, "ampx-with-env.mjs");
type SharedInfraRuntime = Parameters<typeof resolveSandboxEnvironmentName>[1];

type WorkflowCommand =
  | "dev:data"
  | "dev:doctor"
  | "dev:predictor"
  | "dev:prepare"
  | "sandbox:data"
  | "sandbox:doctor"
  | "sandbox:predictor"
  | "sandbox:secret:sync"
  | "sandbox:up";

type DoctorCheck = {
  detail: string;
  label: string;
  remediation?: string;
  status: "fail" | "pass" | "warn";
};

type DoctorReport = {
  checks: DoctorCheck[];
  environmentName: string;
  title: string;
};

type CommandCapture = {
  status: number;
  stderr: string;
  stdout: string;
};

type WorkflowRuntime = {
  directoryExists: (path: PathLike) => boolean;
  env: NodeJS.ProcessEnv;
  execAwsJson: (args: string[]) => unknown;
  fileExists: (path: PathLike) => boolean;
  mkdirp: (path: string) => void;
  nowIso: () => string;
  readFile: (path: string) => string;
  spawnSync: (
    command: string,
    args: string[],
    options?: SpawnSyncOptions,
  ) => {
    status: number | null;
    stderr?: string | Buffer | null;
    stdout?: string | Buffer | null;
  };
  userName: () => string;
  write: (message: string) => void;
  writeError: (message: string) => void;
  writeFile: (path: string, contents: string) => void;
};

type ParsedWorkflowArgs = {
  args: string[];
  command: WorkflowCommand;
};

type PredictorCommandOptions = {
  artifactPrefix: string | null;
  identifier: string | null;
  releaseId: string | null;
  usePin: boolean;
};

function asSharedInfraRuntime(runtime: WorkflowRuntime): SharedInfraRuntime {
  return runtime as unknown as SharedInfraRuntime;
}

export const __testing = {
  collectDevDoctorReport,
  collectSandboxDoctorReport,
  parseWorkflowArgs,
  parsePredictorCommandOptions,
  printDoctorReport,
  runDevPrepare,
  runCommandCapture,
  runSandboxSecretSync,
  runSandboxUp,
};

export function parseWorkflowArgs(argv: string[]): ParsedWorkflowArgs {
  const [command, ...args] = argv;

  if (!command) {
    throw new Error(
      "Pass one of: sandbox:doctor, sandbox:secret:sync, sandbox:data, sandbox:predictor, sandbox:up, dev:doctor, dev:data, dev:predictor, dev:prepare.",
    );
  }

  const supportedCommands = new Set<WorkflowCommand>([
    "sandbox:doctor",
    "sandbox:secret:sync",
    "sandbox:data",
    "sandbox:predictor",
    "sandbox:up",
    "dev:doctor",
    "dev:data",
    "dev:predictor",
    "dev:prepare",
  ]);
  if (!supportedCommands.has(command as WorkflowCommand)) {
    throw new Error(
      `Unsupported deploy workflow command '${command}'.`,
    );
  }

  return {
    args,
    command: command as WorkflowCommand,
  };
}

export function collectSandboxDoctorReport(
  sandboxArgs: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): DoctorReport {
  const environmentName = resolveSandboxEnvironmentName(
    ["sandbox", ...sandboxArgs],
    asSharedInfraRuntime(runtime),
  );
  const sandboxIdentifier = resolveSandboxIdentifier(
    ["sandbox", ...sandboxArgs],
    asSharedInfraRuntime(runtime),
  );
  const region = resolveRegion(runtime.env);
  const checks: DoctorCheck[] = [];

  const deploySecret = normalizeOptionalString(runtime.env[sandboxSecretName]);
  checks.push(
    deploySecret
      ? {
          detail: `Loaded ${sandboxSecretName} from local deploy env for ${environmentName}.`,
          label: "Local deploy secret",
          status: "pass",
        }
      : {
          detail: `Missing ${sandboxSecretName} in ${join(workspaceRoot, ".env.deploy.local")}.`,
          label: "Local deploy secret",
          remediation: `Populate ${join(workspaceRoot, ".env.deploy.local")} with ${sandboxSecretName}=<raw-secret>.`,
          status: "fail",
        },
  );

  const missingAppEnv = requiredSandboxAppEnvNames.filter(
    (name) => !normalizeOptionalString(runtime.env[name]),
  );
  checks.push(
    missingAppEnv.length === 0
      ? {
          detail: "Required bb-amplify local .env values are present.",
          label: "App .env",
          status: "pass",
        }
      : {
          detail: `Missing required app env values: ${missingAppEnv.join(", ")}.`,
          label: "App .env",
          remediation: `Populate ${join(projectRoot, ".env")} before starting the sandbox.`,
          status: "fail",
        },
  );

  checks.push(checkAwsIdentity(region, runtime));
  checks.push(checkSandboxSecret(sandboxIdentifier, runtime));

  const sharedInfraCheck = checkSharedInfraParameters(environmentName, region, runtime);
  checks.push(sharedInfraCheck);

  const predictorCommand = buildSandboxPredictorNpmCommand(sandboxArgs, false);
  checks.push(
    checkPredictorEndpoint({
      environmentName,
      region,
      remediation: predictorCommand,
      runtime,
    }),
  );

  const pinInspection = inspectPredictorTargetPin(
    "sandbox",
    resolvePredictorTargetsFilePath(),
    runtime,
  );
  if (pinInspection.status === "ready") {
    checks.push({
      detail: `Pinned sandbox predictor release '${pinInspection.pin.releaseId}' is ready at ${pinInspection.pin.artifactPrefix}.`,
      label: "Predictor pin",
      status: "pass",
    });
  } else if (pinInspection.status === "missing") {
    checks.push({
      detail: pinInspection.message,
      label: "Predictor pin",
      remediation: predictorCommand,
      status: sharedInfraCheck.status === "pass" ? "warn" : "warn",
    });
  } else {
    checks.push({
      detail: pinInspection.message,
      label: "Predictor pin",
      remediation: predictorCommand,
      status: "fail",
    });
  }

  return {
    checks,
    environmentName,
    title: `Sandbox doctor for ${environmentName}`,
  };
}

export function collectDevDoctorReport(
  runtime: WorkflowRuntime = createDefaultRuntime(),
): DoctorReport {
  const environmentName = "dev";
  const region = resolveRegion(runtime.env);
  const checks: DoctorCheck[] = [];

  const deploySecret = normalizeOptionalString(runtime.env[sandboxSecretName]);
  checks.push(
    deploySecret
      ? {
          detail: `Loaded ${sandboxSecretName} from local deploy env for dev deploys.`,
          label: "Local deploy secret",
          status: "pass",
        }
      : {
          detail: `Missing ${sandboxSecretName} in ${join(workspaceRoot, ".env.deploy.local")}.`,
          label: "Local deploy secret",
          remediation: `Populate ${join(workspaceRoot, ".env.deploy.local")} with ${sandboxSecretName}=<raw-secret>.`,
          status: "fail",
        },
  );

  checks.push(checkAwsIdentity(region, runtime));
  checks.push(checkSharedInfraParameters(environmentName, region, runtime));
  checks.push(
    checkPredictorEndpoint({
      environmentName,
      region,
      remediation: buildDevPredictorNpmCommand(false),
      runtime,
    }),
  );

  const pinInspection = inspectPredictorTargetPin(
    "dev",
    resolvePredictorTargetsFilePath(),
    runtime,
  );
  if (pinInspection.status === "ready") {
    checks.push({
      detail: `Pinned dev predictor release '${pinInspection.pin.releaseId}' is ready at ${pinInspection.pin.artifactPrefix}.`,
      label: "Predictor pin",
      status: "pass",
    });
  } else if (pinInspection.status === "missing") {
    checks.push({
      detail: pinInspection.message,
      label: "Predictor pin",
      remediation: buildDevPredictorNpmCommand(false),
      status: "warn",
    });
  } else {
    checks.push({
      detail: pinInspection.message,
      label: "Predictor pin",
      remediation: buildDevPredictorNpmCommand(false),
      status: "fail",
    });
  }

  return {
    checks,
    environmentName,
    title: "Dev doctor",
  };
}

export function printDoctorReport(
  report: DoctorReport,
  runtime: Pick<WorkflowRuntime, "write"> = createDefaultRuntime(),
): void {
  runtime.write(`${report.title}\n`);
  for (const check of report.checks) {
    runtime.write(`[${check.status.toUpperCase()}] ${check.label}: ${check.detail}`);
    if (check.remediation) {
      runtime.write(`  Fix: ${check.remediation}`);
    }
  }
}

export function main(argv = process.argv.slice(2)): void {
  loadDeployWorkflowEnv();
  const parsed = parseWorkflowArgs(argv);

  switch (parsed.command) {
    case "sandbox:doctor": {
      const report = collectSandboxDoctorReport(parsed.args);
      printDoctorReport(report);
      process.exit(hasDoctorFailure(report) ? 1 : 0);
      break;
    }
    case "sandbox:secret:sync":
      runSandboxSecretSync(parsed.args);
      break;
    case "sandbox:data":
      runSandboxData(parsed.args);
      break;
    case "sandbox:predictor":
      runSandboxPredictor(parsed.args);
      break;
    case "sandbox:up":
      process.exit(runSandboxUp(parsed.args));
      break;
    case "dev:doctor": {
      const report = collectDevDoctorReport();
      printDoctorReport(report);
      process.exit(hasDoctorFailure(report) ? 1 : 0);
      break;
    }
    case "dev:data":
      runDevData();
      break;
    case "dev:predictor":
      runDevPredictor(parsed.args);
      break;
    case "dev:prepare":
      process.exit(runDevPrepare(parsed.args));
      break;
    default:
      throw new Error(`Unsupported deploy workflow command '${parsed.command}'.`);
  }
}

function runSandboxSecretSync(
  sandboxArgs: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const argsWithoutForce = removeFlag(sandboxArgs, "--force");
  const force = argsWithoutForce.length !== sandboxArgs.length;
  const sandboxIdentifier = resolveSandboxIdentifier(
    ["sandbox", ...argsWithoutForce],
    asSharedInfraRuntime(runtime),
  );
  const deploySecret = normalizeOptionalString(runtime.env[sandboxSecretName]);
  if (!deploySecret) {
    throw new Error(
      `Missing ${sandboxSecretName}. Populate ${join(workspaceRoot, ".env.deploy.local")} before syncing sandbox secrets.`,
    );
  }

  if (!force && hasSandboxSecret(sandboxIdentifier, runtime)) {
    runtime.write(
      `Sandbox secret ${sandboxSecretName} already exists for sandbox-${sandboxIdentifier}.`,
    );
    return;
  }

  runtime.write(`Syncing ${sandboxSecretName} into sandbox-${sandboxIdentifier}.`);
  const result = runtime.spawnSync(
    resolveNpxCommand(),
    [
      "ampx",
      "sandbox",
      "secret",
      "set",
      sandboxSecretName,
      "--identifier",
      sandboxIdentifier,
    ],
    {
      cwd: projectRoot,
      env: runtime.env,
      input: `${deploySecret}\n`,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `Failed to sync ${sandboxSecretName} into sandbox-${sandboxIdentifier}.`,
    );
  }
}

function runSandboxData(
  sandboxArgs: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const deploySecret = normalizeOptionalString(runtime.env[sandboxSecretName]);
  if (!deploySecret) {
    throw new Error(
      `Missing ${sandboxSecretName}. Populate ${join(workspaceRoot, ".env.deploy.local")} before deploying shared infra.`,
    );
  }

  const command = createSharedInfraBootstrapCommand(
    ["sandbox", ...sandboxArgs],
    asSharedInfraRuntime(runtime),
  );
  runtime.write(`Deploying ML Data Infra for ${command.environmentName}.`);
  const result = runtime.spawnSync(command.command, command.args, {
    cwd: projectRoot,
    env: {
      ...runtime.env,
      BB_SHARED_ENVIRONMENT_NAME: command.environmentName,
    },
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `ML Data Infra deploy failed for ${command.environmentName}.`,
    );
  }
}

function runSandboxPredictor(
  args: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const options = parsePredictorCommandOptions(args, true);
  const sandboxArgs = buildSandboxArgsFromIdentifier(options.identifier);
  const sandboxIdentifier = resolveSandboxIdentifier(
    ["sandbox", ...sandboxArgs],
    asSharedInfraRuntime(runtime),
  );
  const environmentName = resolveSandboxEnvironmentName(
    ["sandbox", ...sandboxArgs],
    asSharedInfraRuntime(runtime),
  );
  const runMode = options.usePin ? "pinned" : "explicit";

  runtime.write(`Deploying predictor for ${environmentName} using ${runMode} inputs.`);
  runPredictorRelease({
    args: buildPredictorReleaseArgs("sandbox", options, sandboxIdentifier, runtime),
    runtime,
  });

  const pin = resolveWrittenPin("sandbox", options, runtime);
  writePredictorTargetPin("sandbox", pin, resolvePredictorTargetsFilePath(), runtime);
  runtime.write(`Updated sandbox predictor pin '${pin.releaseId}'.`);
}

function runSandboxUp(
  sandboxArgs: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): number {
  const environmentName = resolveSandboxEnvironmentName(
    ["sandbox", ...sandboxArgs],
    asSharedInfraRuntime(runtime),
  );
  runtime.write(`Preparing ${environmentName}.`);

  runSandboxSecretSync(sandboxArgs, runtime);
  runSandboxData(sandboxArgs, runtime);

  const predictorStatus = inspectPredictorEndpoint({
    environmentName,
    region: resolveRegion(runtime.env),
    runtime,
  });
  if (predictorStatus.status === "missing") {
    const pinInspection = inspectPredictorTargetPin(
      "sandbox",
      resolvePredictorTargetsFilePath(),
      runtime,
    );
    if (pinInspection.status !== "ready") {
      throw new Error(
        [
          predictorStatus.detail,
          `From ${projectRoot} run: ${buildSandboxPredictorNpmCommand(sandboxArgs, false)}`,
        ].join(" "),
      );
    }

    runtime.write(
      `Predictor is missing for ${environmentName}; deploying the pinned sandbox release '${pinInspection.pin.releaseId}'.`,
    );
    runPredictorRelease({
      args: buildPredictorReleaseArgs(
        "sandbox",
        { artifactPrefix: null, identifier: null, releaseId: null, usePin: true },
        resolveSandboxIdentifier(
          ["sandbox", ...sandboxArgs],
          asSharedInfraRuntime(runtime),
        ),
        runtime,
      ),
      runtime,
    });
  } else if (predictorStatus.status === "not-ready") {
    throw new Error(
      [
        predictorStatus.detail,
        `From ${projectRoot} run: ${buildSandboxPredictorNpmCommand(sandboxArgs, true)}`,
      ].join(" "),
    );
  }

  const result = runtime.spawnSync(
    process.execPath,
    [ampxWithEnvScriptPath, "sandbox", ...sandboxArgs],
    {
      cwd: projectRoot,
      env: {
        ...runtime.env,
        [skipSandboxSharedInfraBootstrapEnvName]: "1",
      },
      stdio: "inherit",
    },
  );
  return result.status ?? 1;
}

function runDevData(runtime: WorkflowRuntime = createDefaultRuntime()): void {
  const deploySecret = normalizeOptionalString(runtime.env[sandboxSecretName]);
  if (!deploySecret) {
    throw new Error(
      `Missing ${sandboxSecretName}. Populate ${join(workspaceRoot, ".env.deploy.local")} before deploying shared infra.`,
    );
  }

  runtime.write("Deploying ML Data Infra for dev.");
  const result = runtime.spawnSync(
    resolveNpxCommand(),
    [
      "--prefix",
      join(workspaceRoot, "bb-shared-infra"),
      "run",
      "deploy:ml-data-infra",
      "--",
      "--environment",
      "dev",
    ],
    {
      cwd: projectRoot,
      env: runtime.env,
      stdio: "inherit",
    },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error("ML Data Infra deploy failed for dev.");
  }
}

function runDevPredictor(
  args: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const options = parsePredictorCommandOptions(args, false);
  runtime.write(`Deploying predictor for dev using ${options.usePin ? "pinned" : "explicit"} inputs.`);
  runPredictorRelease({
    args: buildPredictorReleaseArgs("dev", options, null, runtime),
    runtime,
  });
  const pin = resolveWrittenPin("dev", options, runtime);
  writePredictorTargetPin("dev", pin, resolvePredictorTargetsFilePath(), runtime);
  runtime.write(`Updated dev predictor pin '${pin.releaseId}'.`);
}

function runDevPrepare(
  args: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): number {
  runDevData(runtime);

  const predictorStatus = inspectPredictorEndpoint({
    environmentName: "dev",
    region: resolveRegion(runtime.env),
    runtime,
  });
  if (predictorStatus.status !== "ready") {
    runDevPredictor(args.length > 0 ? args : ["--use-pin"], runtime);
  }

  const report = collectDevDoctorReport(runtime);
  printDoctorReport(report, runtime);
  if (hasDoctorFailure(report)) {
    return 1;
  }

  runtime.write(
    "Next step: trigger the Amplify Hosting deploy for the dev branch.",
  );
  return 0;
}

function checkAwsIdentity(
  region: string,
  runtime: WorkflowRuntime,
): DoctorCheck {
  let account = "<unknown>";
  try {
    const identity = runtime.execAwsJson([
      "sts",
      "get-caller-identity",
      "--output",
      "json",
    ]) as {
      Account?: string;
    };
    account = normalizeOptionalString(identity.Account) ?? "<unknown>";
  } catch (error) {
    return {
      detail: `AWS identity lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      label: "AWS account",
      remediation: `Check your AWS credentials and confirm they target account ${expectedAwsAccount}.`,
      status: "fail",
    };
  }

  if (account !== expectedAwsAccount) {
    return {
      detail: `Current AWS account is ${account}; expected ${expectedAwsAccount}.`,
      label: "AWS account",
      remediation: `Switch credentials back to account ${expectedAwsAccount}.`,
      status: "fail",
    };
  }

  if (region !== defaultAwsRegion) {
    return {
      detail: `Current AWS region resolves to ${region}; expected ${defaultAwsRegion}.`,
      label: "AWS region",
      remediation: `Set AWS_REGION=${defaultAwsRegion} or AWS_DEFAULT_REGION=${defaultAwsRegion}.`,
      status: "fail",
    };
  }

  return {
    detail: `AWS account ${account} in ${region}.`,
    label: "AWS account",
    status: "pass",
  };
}

function checkSandboxSecret(
  sandboxIdentifier: string,
  runtime: WorkflowRuntime,
): DoctorCheck {
  const defaultIdentifier = resolveSandboxIdentifier(
    ["sandbox"],
    asSharedInfraRuntime(runtime),
  );
  try {
    const exists = hasSandboxSecret(sandboxIdentifier, runtime);
    return exists
      ? {
          detail: `${sandboxSecretName} is present for sandbox-${sandboxIdentifier}.`,
          label: "Sandbox secret",
          status: "pass",
        }
      : {
          detail: `${sandboxSecretName} is missing for sandbox-${sandboxIdentifier}.`,
          label: "Sandbox secret",
          remediation: `From ${projectRoot} run: npm run sandbox:secret:sync${sandboxIdentifier === defaultIdentifier ? "" : ` -- --identifier ${sandboxIdentifier}`}`,
          status: "fail",
        };
  } catch (error) {
    return {
      detail: `Unable to read sandbox secrets: ${error instanceof Error ? error.message : String(error)}`,
      label: "Sandbox secret",
      remediation: `Check AWS credentials, then retry npm run sandbox:secret:sync.`,
      status: "fail",
    };
  }
}

function checkSharedInfraParameters(
  environmentName: string,
  region: string,
  runtime: WorkflowRuntime,
): DoctorCheck {
  try {
    const contract = runtime.execAwsJson([
      "ssm",
      "get-parameters",
      "--with-decryption",
      "--region",
      region,
      "--output",
      "json",
      "--names",
      ...Object.values(buildSharedInfraParameterPaths(environmentName)),
    ]) as {
      InvalidParameters?: string[];
    };
    const missing = (contract.InvalidParameters ?? [])
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => Boolean(value));
    if (missing.length > 0) {
      return {
        detail: `Missing shared infra contract parameters: ${missing.join(", ")}.`,
        label: "Shared infra SSM contract",
        remediation:
          environmentName === "dev"
            ? `From ${projectRoot} run: npm run dev:data`
            : `From ${projectRoot} run: npm run sandbox:data`,
        status: "fail",
      };
    }

    return {
      detail: `Shared infra SSM contract is present for ${environmentName}.`,
      label: "Shared infra SSM contract",
      status: "pass",
    };
  } catch (error) {
    return {
      detail: `Unable to read shared infra SSM parameters: ${error instanceof Error ? error.message : String(error)}`,
      label: "Shared infra SSM contract",
      remediation:
        environmentName === "dev"
          ? `From ${projectRoot} run: npm run dev:data`
          : `From ${projectRoot} run: npm run sandbox:data`,
      status: "fail",
    };
  }
}

function checkPredictorEndpoint({
  environmentName,
  region,
  remediation,
  runtime,
}: {
  environmentName: string;
  region: string;
  remediation: string;
  runtime: WorkflowRuntime;
}): DoctorCheck {
  const inspection = inspectPredictorEndpoint({
    environmentName,
    region,
    runtime,
  });
  if (inspection.status === "ready") {
    return {
      detail: `Predictor endpoint '${inspection.endpointName}' is InService.`,
      label: "Predictor endpoint",
      status: "pass",
    };
  }

  return {
    detail: inspection.detail,
    label: "Predictor endpoint",
    remediation,
    status: "fail",
  };
}

function inspectPredictorEndpoint({
  environmentName,
  region,
  runtime,
}: {
  environmentName: string;
  region: string;
  runtime: WorkflowRuntime;
}):
  | {
      endpointName: string;
      status: "ready";
    }
  | {
      detail: string;
      endpointName?: string;
      status: "missing" | "not-ready";
    } {
  const parameterPath =
    buildSharedInfraParameterPaths(environmentName).predictionEndpointName;

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
      parameterPath,
    ]) as {
      InvalidParameters?: string[];
      Parameters?: Array<{
        Name?: string;
        Value?: string;
      }>;
    };
  } catch (error) {
    return {
      detail: `Unable to read predictor endpoint parameter '${parameterPath}': ${error instanceof Error ? error.message : String(error)}`,
      status: "missing",
    };
  }

  const endpointName = normalizeOptionalString(
    parameterResponse.Parameters?.find(
      (parameter) => normalizeOptionalString(parameter.Name) === parameterPath,
    )?.Value,
  );
  if (!endpointName) {
    return {
      detail: `Predictor endpoint contract parameter is missing: ${parameterPath}.`,
      status: "missing",
    };
  }

  try {
    const endpoint = runtime.execAwsJson([
      "sagemaker",
      "describe-endpoint",
      "--region",
      region,
      "--output",
      "json",
      "--endpoint-name",
      endpointName,
    ]) as {
      EndpointStatus?: string;
    };
    const status = normalizeOptionalString(endpoint.EndpointStatus);
    if (status !== "InService") {
      return {
        detail: `Predictor endpoint '${endpointName}' is not ready. Current status: ${status ?? "unknown"}.`,
        endpointName,
        status: "not-ready",
      };
    }
  } catch (_error) {
    return {
      detail: `Predictor endpoint '${endpointName}' is missing in SageMaker.`,
      endpointName,
      status: "missing",
    };
  }

  return {
    endpointName,
    status: "ready",
  };
}

function runPredictorRelease({
  args,
  runtime,
}: {
  args: string[];
  runtime: WorkflowRuntime;
}): void {
  const result = runtime.spawnSync("./scripts/matchup-predictor-release", args, {
    cwd: workspaceRoot,
    env: runtime.env,
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("Predictor deployment failed.");
  }
}

function resolveWrittenPin(
  targetName: PredictorTargetName,
  options: PredictorCommandOptions,
  runtime: WorkflowRuntime,
) {
  if (options.usePin) {
    const existing = resolvePredictorTargetPin(
      targetName,
      resolvePredictorTargetsFilePath(),
      runtime,
    );
    return createPredictorTargetPin(
      existing.releaseId,
      existing.artifactPrefix,
      runtime,
    );
  }

  return createPredictorTargetPin(
    normalizeOptionalString(options.releaseId) ?? "",
    normalizeOptionalString(options.artifactPrefix) ?? "",
    runtime,
  );
}

function buildPredictorReleaseArgs(
  stage: "dev" | "sandbox",
  options: PredictorCommandOptions,
  sandboxIdentifier: string | null,
  runtime: WorkflowRuntime,
): string[] {
  const args: string[] = [stage];

  if (stage === "sandbox") {
    const explicitIdentifier = normalizeOptionalString(options.identifier);
    if (explicitIdentifier) {
      args.push("--identifier", explicitIdentifier);
    } else if (sandboxIdentifier) {
      const defaultIdentifier = resolveSandboxIdentifier(
        ["sandbox"],
        asSharedInfraRuntime(runtime),
      );
      if (sandboxIdentifier !== defaultIdentifier) {
        args.push("--identifier", sandboxIdentifier);
      }
    }
  }

  const releaseId = normalizeOptionalString(options.releaseId);
  const artifactPrefix = normalizeOptionalString(options.artifactPrefix);
  if (releaseId && artifactPrefix) {
    args.push("--release-id", releaseId, "--artifact-prefix", artifactPrefix);
    return args;
  }

  if (releaseId || artifactPrefix) {
    throw new Error(
      "Provide both --release-id and --artifact-prefix together, or use --use-pin.",
    );
  }

  if (!options.usePin) {
    const command =
      stage === "sandbox"
        ? buildSandboxPredictorNpmCommand(
            buildSandboxArgsFromIdentifier(sandboxIdentifier),
            false,
          )
        : buildDevPredictorNpmCommand(false);
    throw new Error(
      `Predictor deployment requires --release-id and --artifact-prefix, or --use-pin. From ${projectRoot} run: ${command}`,
    );
  }

  args.push("--use-pin", stage);
  return args;
}

function parsePredictorCommandOptions(
  argv: string[],
  allowIdentifier: boolean,
): PredictorCommandOptions {
  let artifactPrefix: string | null = null;
  let identifier: string | null = null;
  let releaseId: string | null = null;
  let usePin = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--use-pin") {
      usePin = true;
      continue;
    }
    if (argument === "--release-id") {
      releaseId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--release-id=")) {
      releaseId = argument.slice("--release-id=".length);
      continue;
    }
    if (argument === "--artifact-prefix") {
      artifactPrefix = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--artifact-prefix=")) {
      artifactPrefix = argument.slice("--artifact-prefix=".length);
      continue;
    }
    if (allowIdentifier && argument === "--identifier") {
      identifier = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (allowIdentifier && argument?.startsWith("--identifier=")) {
      identifier = argument.slice("--identifier=".length);
      continue;
    }

    throw new Error(`Unsupported option '${argument}'.`);
  }

  return {
    artifactPrefix,
    identifier,
    releaseId,
    usePin,
  };
}

function hasDoctorFailure(report: DoctorReport): boolean {
  return report.checks.some((check) => check.status === "fail");
}

function hasSandboxSecret(
  sandboxIdentifier: string,
  runtime: WorkflowRuntime,
): boolean {
  const result = runCommandCapture(
    runtime,
    resolveNpxCommand(),
    [
      "ampx",
      "sandbox",
      "secret",
      "list",
      "--identifier",
      sandboxIdentifier,
    ],
    {
      cwd: projectRoot,
      env: runtime.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "ampx sandbox secret list failed.");
  }

  return result.stdout.includes(sandboxSecretName);
}

function buildSandboxArgsFromIdentifier(identifier: string | null): string[] {
  const normalized = normalizeOptionalString(identifier);
  return normalized ? ["--identifier", normalized] : [];
}

function buildSandboxPredictorNpmCommand(
  sandboxArgs: string[],
  usePin: boolean,
): string {
  const commandParts = ["npm run sandbox:predictor --"];
  const explicitArgs = buildSandboxPredictorReleaseCommand(["sandbox", ...sandboxArgs]);
  const sandboxIdentifier = normalizeOptionalString(explicitArgs.sandboxIdentifier);
  if (
    sandboxIdentifier &&
    sandboxArgs.some(
      (argument) =>
        argument === "--identifier" || argument.startsWith("--identifier="),
    )
  ) {
    commandParts.push("--identifier", sandboxIdentifier);
  }
  if (usePin) {
    commandParts.push("--use-pin");
  } else {
    commandParts.push(
      "--release-id",
      "<release-id>",
      "--artifact-prefix",
      "<absolute-artifact-stem>",
    );
  }

  return commandParts.join(" ");
}

function buildDevPredictorNpmCommand(usePin: boolean): string {
  return usePin
    ? "npm run dev:predictor -- --use-pin"
    : "npm run dev:predictor -- --release-id <release-id> --artifact-prefix <absolute-artifact-stem>";
}

function removeFlag(argv: string[], flagName: string): string[] {
  return argv.filter((argument) => argument !== flagName);
}

function resolveRegion(env: NodeJS.ProcessEnv): string {
  return (
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION) ??
    defaultAwsRegion
  );
}

export function runCommandCapture(
  runtime: Pick<WorkflowRuntime, "spawnSync">,
  command: string,
  args: string[],
  options: SpawnSyncOptions = {},
): CommandCapture {
  const result = runtime.spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    status: result.status ?? 1,
    stderr: normalizeText(result.stderr),
    stdout: normalizeText(result.stdout),
  };
}

function normalizeText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Buffer) {
    return value.toString("utf8");
  }

  return "";
}

function resolveNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function createDefaultRuntime(): WorkflowRuntime {
  return {
    directoryExists: existsSync,
    env: process.env,
    execAwsJson: (args) =>
      JSON.parse(
        execFileSync("aws", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    fileExists: existsSync,
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    nowIso: () => new Date().toISOString(),
    readFile: (path) => readFileSync(path, "utf8"),
    spawnSync,
    userName: () => os.userInfo().username || "local",
    write: (message) => {
      process.stdout.write(`${message}\n`);
    },
    writeError: (message) => {
      process.stderr.write(`${message}\n`);
    },
    writeFile: (path, contents) => {
      writeFileSync(path, contents, "utf8");
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
