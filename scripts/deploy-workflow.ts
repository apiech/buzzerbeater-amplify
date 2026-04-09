import { execFileSync, spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  type PathLike,
} from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildBbConnectionSecretParameterPaths,
  buildSharedInfraParameterPaths,
} from "../amplify/_shared/shared-infra-contract.js";
import { getParametersByName } from "../amplify/_shared/aws-cli-ssm.js";
import {
  createSharedInfraBootstrapCommand,
  resolveSandboxEnvironmentName,
  resolveSandboxIdentifier,
  skipSandboxSharedInfraBootstrapEnvName,
} from "./shared-infra-bootstrap.mjs";
import {
  createOpponentForecastTargetPin,
  createPredictorTargetPin,
  defaultAwsRegion,
  expectedAwsAccount,
  inspectPredictorTargetPin,
  loadDeployWorkflowEnv,
  resolveOpponentForecastTargetPin,
  resolveOpponentForecastTargetsFilePath,
  projectRoot,
  requiredSandboxAppEnvNames,
  resolvePredictorTargetPin,
  resolvePredictorTargetsFilePath,
  sandboxSecretName,
  type OpponentForecastTargetName,
  type PredictorTargetName,
  writeOpponentForecastTargetPin,
  writePredictorTargetPin,
  workspaceRoot,
} from "./deploy-runtime.js";
import { normalizeOptionalString } from "./project-env.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const ampxWithEnvScriptPath = join(currentDir, "ampx-with-env.mjs");
const skipDeployVerifyEnvName = "BB_SKIP_DEPLOY_VERIFY";
const sandboxFastFlag = "--fast";
type SharedInfraRuntime = Pick<WorkflowRuntime, "env" | "userName">;

type WorkflowCommand =
  | "dev:data"
  | "dev:doctor"
  | "dev:opponent-forecast"
  | "dev:predictor"
  | "dev:prepare"
  | "sandbox:data"
  | "sandbox:doctor"
  | "sandbox:opponent-forecast"
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
  listDir: (path: string) => string[];
  mkdirp: (path: string) => void;
  nowIso: () => string;
  readFile: (path: string) => string;
  removeFile: (path: string) => void;
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

type OpponentForecastCommandOptions = {
  datasetRoot: string | null;
  identifier: string | null;
  releaseId: string | null;
  usePin: boolean;
};

const dockerConfigRoot = join(
  workspaceRoot,
  "bb-machine-learning",
  "dist",
  ".docker-cli",
);
const sandboxCdkOutPath = join(projectRoot, ".amplify", "artifacts", "cdk.out");
const sandboxReadLockPattern = /^read\.(\d+)\.\d+\.lock$/;

function asSharedInfraRuntime(runtime: WorkflowRuntime): SharedInfraRuntime {
  return {
    env: runtime.env,
    userName: runtime.userName,
  };
}

export const __testing = {
  collectDevDoctorReport,
  collectSandboxDoctorReport,
  parseWorkflowArgs,
  parseOpponentForecastCommandOptions,
  parsePredictorCommandOptions,
  printDoctorReport,
  runDevOpponentForecast,
  runDevPrepare,
  runSandboxOpponentForecast,
  runCommandCapture,
  runSandboxSecretSync,
  runSandboxUp,
};

export function parseWorkflowArgs(argv: string[]): ParsedWorkflowArgs {
  const [command, ...args] = argv;

  if (!command) {
    throw new Error(
      "Pass one of: sandbox:doctor, sandbox:secret:sync, sandbox:data, sandbox:predictor, sandbox:opponent-forecast, sandbox:up, dev:doctor, dev:data, dev:predictor, dev:opponent-forecast, dev:prepare.",
    );
  }

  const supportedCommands = new Set<WorkflowCommand>([
    "sandbox:doctor",
    "sandbox:secret:sync",
    "sandbox:data",
    "sandbox:predictor",
    "sandbox:opponent-forecast",
    "sandbox:up",
    "dev:doctor",
    "dev:data",
    "dev:predictor",
    "dev:opponent-forecast",
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

  const sandboxDeployCommand = buildRootSandboxDeployCommand(sandboxIdentifier);
  checks.push(
    checkPredictorEndpoint({
      environmentName,
      region,
      remediation: sandboxDeployCommand,
      runtime,
    }),
  );

  const pinInspection = inspectPredictorTargetPin(
    "sandbox",
    resolvePredictorTargetsFilePath(),
    runtime,
    { sandboxIdentifier },
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
      remediation: sandboxDeployCommand,
      status: sharedInfraCheck.status === "pass" ? "warn" : "warn",
    });
  } else {
    checks.push({
      detail: pinInspection.message,
      label: "Predictor pin",
      remediation: sandboxDeployCommand,
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
      remediation: buildRootDeployCommand("dev"),
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
      remediation: buildRootDeployCommand("dev"),
      status: "warn",
    });
  } else {
    checks.push({
      detail: pinInspection.message,
      label: "Predictor pin",
      remediation: buildRootDeployCommand("dev"),
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
    case "sandbox:opponent-forecast":
      runSandboxOpponentForecast(parsed.args);
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
    case "dev:opponent-forecast":
      runDevOpponentForecast(parsed.args);
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
    env: buildDockerCliEnv(runtime, {
      BB_SHARED_ENVIRONMENT_NAME: command.environmentName,
    }),
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
    args: buildPredictorReleaseArgs("sandbox", options, sandboxIdentifier),
    runtime,
  });

  const pin = resolveWrittenPin("sandbox", options, runtime, sandboxIdentifier);
  writePredictorTargetPin("sandbox", pin, resolvePredictorTargetsFilePath(), runtime, {
    sandboxIdentifier,
  });
  runtime.write(
    `Updated sandbox predictor pin '${pin.releaseId}' for sandbox-${sandboxIdentifier}.`,
  );
}

function runSandboxOpponentForecast(
  args: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const options = parseOpponentForecastCommandOptions(args, true);
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

  runtime.write(
    `Deploying opponent forecast for ${environmentName} using ${runMode} inputs.`,
  );
  runOpponentForecastRelease({
    args: buildOpponentForecastReleaseArgs("sandbox", options, sandboxIdentifier),
    runtime,
  });

  const pin = resolveWrittenOpponentForecastPin(
    "sandbox",
    options,
    runtime,
    sandboxIdentifier,
  );
  writeOpponentForecastTargetPin(
    "sandbox",
    pin,
    resolveOpponentForecastTargetsFilePath(),
    runtime,
    { sandboxIdentifier },
  );
  runtime.write(
    `Updated sandbox opponent forecast pin '${pin.releaseId}' for sandbox-${sandboxIdentifier}.`,
  );
}

function runVerifyDeploy(
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const result = runtime.spawnSync(resolveNpmCommand(), ["run", "verify:deploy"], {
    cwd: projectRoot,
    env: runtime.env,
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("Deploy verification failed.");
  }
}

function runSandboxVerifyDeploy(
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const result = runtime.spawnSync(
    resolveNpmCommand(),
    ["run", "verify:deploy:sandbox"],
    {
      cwd: projectRoot,
      env: runtime.env,
      stdio: "inherit",
    },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error("Sandbox deploy verification failed.");
  }
}

function runSandboxUp(
  sandboxArgs: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): number {
  const argsWithoutFast = removeFlag(sandboxArgs, sandboxFastFlag);
  const fastMode = argsWithoutFast.length !== sandboxArgs.length;
  const sandboxIdentifier = resolveSandboxIdentifier(
    ["sandbox", ...argsWithoutFast],
    asSharedInfraRuntime(runtime),
  );
  const environmentName = resolveSandboxEnvironmentName(
    ["sandbox", ...argsWithoutFast],
    asSharedInfraRuntime(runtime),
  );
  const explicitSandboxArgs = withResolvedSandboxIdentifier(
    argsWithoutFast,
    sandboxIdentifier,
  );
  runtime.write(
    `Preparing sandbox '${sandboxIdentifier}' with shared environment '${environmentName}'${fastMode ? " using fast deploy mode." : "."}`,
  );
  assertNoConflictingSandboxProcesses(runtime);

  if (normalizeOptionalString(runtime.env[skipDeployVerifyEnvName])) {
    runtime.write("Skipping deploy verification because BB_SKIP_DEPLOY_VERIFY is set.");
  } else if (fastMode) {
    runSandboxVerifyDeploy(runtime);
  } else {
    runVerifyDeploy(runtime);
  }
  runSandboxSecretSync(explicitSandboxArgs, runtime);
  if (fastMode) {
    runtime.write("Skipping shared infra deploy because --fast was requested.");
  } else {
    runSandboxData(explicitSandboxArgs, runtime);
  }

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
      { sandboxIdentifier },
    );
    const remediationCommand =
      pinInspection.status === "ready"
        ? buildSandboxPredictorNpmCommand(sandboxIdentifier, true)
        : buildSandboxPredictorNpmCommand(sandboxIdentifier, false);
    if (fastMode) {
      throw new Error(
        [
          predictorStatus.detail,
          "Fast sandbox deploy requires a ready predictor endpoint.",
          `From ${projectRoot} run: ${remediationCommand}`,
        ].join(" "),
      );
    }
    if (pinInspection.status !== "ready") {
      throw new Error(
        [
          predictorStatus.detail,
          `From ${projectRoot} run: ${remediationCommand}`,
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
        sandboxIdentifier,
      ),
      runtime,
    });
  } else if (predictorStatus.status === "not-ready") {
    const remediationCommand = buildSandboxPredictorNpmCommand(sandboxIdentifier, true);
    if (fastMode) {
      throw new Error(
        [
          predictorStatus.detail,
          "Fast sandbox deploy requires a ready predictor endpoint.",
          `From ${projectRoot} run: ${remediationCommand}`,
        ].join(" "),
      );
    }
    throw new Error(
      [
        predictorStatus.detail,
        `From ${projectRoot} run: ${remediationCommand}`,
      ].join(" "),
    );
  }

  const result = runtime.spawnSync(
    process.execPath,
    [ampxWithEnvScriptPath, "sandbox", ...explicitSandboxArgs],
    {
      cwd: projectRoot,
      env: buildDockerCliEnv(runtime, {
        [skipSandboxSharedInfraBootstrapEnvName]: "1",
        BB_SHARED_ENVIRONMENT_NAME: environmentName,
      }),
      stdio: "inherit",
    },
  );
  return result.status ?? 1;
}

function assertNoConflictingSandboxProcesses(runtime: WorkflowRuntime): void {
  if (!runtime.directoryExists(sandboxCdkOutPath)) {
    return;
  }

  const activeConflicts: Array<{ command: string; lockPath: string; pid: string }> = [];
  for (const entry of runtime.listDir(sandboxCdkOutPath)) {
    const match = sandboxReadLockPattern.exec(entry);
    if (!match) {
      continue;
    }

    const lockPath = join(sandboxCdkOutPath, entry);
    const pid = normalizeOptionalString(runtime.readFile(lockPath)) ?? match[1];
    if (!pid) {
      continue;
    }

    const processCommand = inspectRunningCommand(pid, runtime);
    if (!processCommand) {
      runtime.removeFile(lockPath);
      continue;
    }

    if (!processCommand.includes("ampx")) {
      runtime.removeFile(lockPath);
      continue;
    }

    activeConflicts.push({
      command: processCommand,
      lockPath,
      pid,
    });
  }

  if (activeConflicts.length === 0) {
    return;
  }

  const conflictList = activeConflicts
    .map(({ command, lockPath, pid }) => `PID ${pid}: ${command} (${lockPath})`)
    .join("; ");
  throw new Error(
    `Another Amplify sandbox process is already running for this workspace. Stop it before running sandbox:up. Conflicts: ${conflictList}`,
  );
}

function inspectRunningCommand(
  pid: string,
  runtime: Pick<WorkflowRuntime, "spawnSync">,
): string | null {
  const capture = runCommandCapture(runtime, "ps", ["-p", pid, "-o", "command="]);
  if (capture.status !== 0) {
    return null;
  }

  return normalizeOptionalString(capture.stdout) ?? null;
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
    resolveNpmCommand(),
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
      env: buildDockerCliEnv(runtime),
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
    args: buildPredictorReleaseArgs("dev", options, null),
    runtime,
  });
  const pin = resolveWrittenPin("dev", options, runtime);
  writePredictorTargetPin("dev", pin, resolvePredictorTargetsFilePath(), runtime);
  runtime.write(`Updated dev predictor pin '${pin.releaseId}'.`);
}

function runDevOpponentForecast(
  args: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): void {
  const options = parseOpponentForecastCommandOptions(args, false);
  runtime.write(
    `Deploying opponent forecast for dev using ${options.usePin ? "pinned" : "explicit"} inputs.`,
  );
  runOpponentForecastRelease({
    args: buildOpponentForecastReleaseArgs("dev", options, null),
    runtime,
  });
  const pin = resolveWrittenOpponentForecastPin("dev", options, runtime);
  writeOpponentForecastTargetPin(
    "dev",
    pin,
    resolveOpponentForecastTargetsFilePath(),
    runtime,
  );
  runtime.write(`Updated dev opponent forecast pin '${pin.releaseId}'.`);
}

function runDevPrepare(
  args: string[],
  runtime: WorkflowRuntime = createDefaultRuntime(),
): number {
  runVerifyDeploy(runtime);
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
          remediation: `From ${projectRoot} run: npm run sandbox:secret:sync -- --identifier ${sandboxIdentifier}`,
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
  const parameterPaths = buildSharedInfraParameterPaths(environmentName);
  const bbConnectionSecretPaths =
    buildBbConnectionSecretParameterPaths(environmentName);
  const optionalPaths = new Set([parameterPaths.opponentForecastEndpointName]);
  const requiredSecretPaths = [
    bbConnectionSecretPaths.secret,
    bbConnectionSecretPaths.fingerprint,
  ];

  try {
    const contract = getParametersByName({
      execAwsJson: runtime.execAwsJson,
      names: [...Object.values(parameterPaths), ...requiredSecretPaths],
      region,
    }) as {
      InvalidParameters?: string[];
    };
    const missing = (contract.InvalidParameters ?? [])
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => Boolean(value));
    const missingRequired = missing.filter(
      (value) => !optionalPaths.has(value),
    );
    const missingOptional = missing.filter((value) => optionalPaths.has(value));

    if (missingRequired.length > 0) {
      return {
        detail: `Missing shared infra contract parameters: ${missingRequired.join(", ")}.`,
        label: "Shared infra SSM contract",
        remediation:
          environmentName === "dev"
            ? `From ${projectRoot} run: ${buildRootDeployCommand("dev")}`
            : `From ${projectRoot} run: ${buildRootSandboxDeployCommandForEnvironment(environmentName)}`,
        status: "fail",
      };
    }

    if (missingOptional.length > 0) {
      const remediation =
        environmentName === "dev"
          ? `From ${projectRoot} run: ${buildRootDeployCommand("dev")}`
          : `From ${projectRoot} run: ${buildRootSandboxDeployCommandForEnvironment(environmentName)}`;
      return {
        detail: `Optional shared infra parameters are missing: ${missingOptional.join(", ")}. Opponent forecast jobs remain disabled until the endpoint is deployed.`,
        label: "Shared infra SSM contract",
        remediation,
        status: "warn",
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
          ? `From ${projectRoot} run: ${buildRootDeployCommand("dev")}`
          : `From ${projectRoot} run: ${buildRootSandboxDeployCommandForEnvironment(environmentName)}`,
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

function runOpponentForecastRelease({
  args,
  runtime,
}: {
  args: string[];
  runtime: WorkflowRuntime;
}): void {
  const result = runtime.spawnSync("./scripts/opponent-forecast-release", args, {
    cwd: workspaceRoot,
    env: runtime.env,
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("Opponent forecast deployment failed.");
  }
}

function resolveWrittenPin(
  targetName: PredictorTargetName,
  options: PredictorCommandOptions,
  runtime: WorkflowRuntime,
  sandboxIdentifier: string | null = null,
) {
  if (options.usePin) {
    const existing = resolvePredictorTargetPin(
      targetName,
      resolvePredictorTargetsFilePath(),
      runtime,
      targetName === "sandbox" ? { sandboxIdentifier } : {},
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

function resolveWrittenOpponentForecastPin(
  targetName: OpponentForecastTargetName,
  options: OpponentForecastCommandOptions,
  runtime: WorkflowRuntime,
  sandboxIdentifier: string | null = null,
) {
  if (options.usePin) {
    const existing = resolveOpponentForecastTargetPin(
      targetName,
      resolveOpponentForecastTargetsFilePath(),
      runtime,
      targetName === "sandbox" ? { sandboxIdentifier } : {},
    );
    return createOpponentForecastTargetPin(
      existing.releaseId,
      existing.datasetRoot,
      runtime,
    );
  }

  return createOpponentForecastTargetPin(
    normalizeOptionalString(options.releaseId) ?? "",
    normalizeOptionalString(options.datasetRoot) ?? "",
    runtime,
  );
}

function buildPredictorReleaseArgs(
  stage: "dev" | "sandbox",
  options: PredictorCommandOptions,
  sandboxIdentifier: string | null,
): string[] {
  const args: string[] = [stage];

  if (stage === "sandbox") {
    if (!sandboxIdentifier) {
      throw new Error("Sandbox predictor deployment requires a resolved identifier.");
    }
    args.push("--identifier", sandboxIdentifier);
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
      stage === "sandbox" && sandboxIdentifier
        ? buildSandboxPredictorNpmCommand(sandboxIdentifier, false)
        : buildDevPredictorNpmCommand(false);
    throw new Error(
      `Predictor deployment requires --release-id and --artifact-prefix, or --use-pin. From ${projectRoot} run: ${command}`,
    );
  }

  args.push("--use-pin", stage);
  return args;
}

function buildOpponentForecastReleaseArgs(
  stage: "dev" | "sandbox",
  options: OpponentForecastCommandOptions,
  sandboxIdentifier: string | null,
): string[] {
  const args: string[] = [stage];

  if (stage === "sandbox") {
    if (!sandboxIdentifier) {
      throw new Error(
        "Sandbox opponent forecast deployment requires a resolved identifier.",
      );
    }
    args.push("--identifier", sandboxIdentifier);
  }

  const releaseId = normalizeOptionalString(options.releaseId);
  const datasetRoot = normalizeOptionalString(options.datasetRoot);
  if (releaseId && datasetRoot) {
    args.push("--release-id", releaseId, "--dataset-root", datasetRoot);
    return args;
  }

  if (releaseId || datasetRoot) {
    throw new Error(
      "Provide both --release-id and --dataset-root together, or use --use-pin.",
    );
  }

  if (!options.usePin) {
    const command =
      stage === "sandbox" && sandboxIdentifier
        ? buildSandboxOpponentForecastNpmCommand(sandboxIdentifier, false)
        : buildDevOpponentForecastNpmCommand(false);
    throw new Error(
      `Opponent forecast deployment requires --release-id and --dataset-root, or --use-pin. From ${projectRoot} run: ${command}`,
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

function parseOpponentForecastCommandOptions(
  argv: string[],
  allowIdentifier: boolean,
): OpponentForecastCommandOptions {
  let datasetRoot: string | null = null;
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
    if (argument === "--dataset-root") {
      datasetRoot = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--dataset-root=")) {
      datasetRoot = argument.slice("--dataset-root=".length);
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
    datasetRoot,
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
  sandboxIdentifier: string,
  usePin: boolean,
): string {
  const commandParts = [
    "npm run sandbox:predictor --",
    "--identifier",
    sandboxIdentifier,
  ];
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

function buildSandboxOpponentForecastNpmCommand(
  sandboxIdentifier: string,
  usePin: boolean,
): string {
  const commandParts = [
    "npm run sandbox:opponent-forecast --",
    "--identifier",
    sandboxIdentifier,
  ];
  if (usePin) {
    commandParts.push("--use-pin");
  } else {
    commandParts.push(
      "--release-id",
      "<release-id>",
      "--dataset-root",
      "<absolute-dataset-root>",
    );
  }

  return commandParts.join(" ");
}

function buildDevOpponentForecastNpmCommand(usePin: boolean): string {
  return usePin
    ? "npm run dev:opponent-forecast -- --use-pin"
    : "npm run dev:opponent-forecast -- --release-id <release-id> --dataset-root <absolute-dataset-root>";
}

function buildRootDeployCommand(stage: "dev" | "prod"): string {
  return `./scripts/deploy ${stage}`;
}

function buildRootSandboxDeployCommand(sandboxIdentifier: string): string {
  return `./scripts/deploy sandbox-${sandboxIdentifier}`;
}

function buildRootSandboxDeployCommandForEnvironment(environmentName: string): string {
  return `./scripts/deploy ${environmentName}`;
}

function withResolvedSandboxIdentifier(
  sandboxArgs: string[],
  sandboxIdentifier: string,
): string[] {
  return [...buildSandboxArgsFromIdentifier(sandboxIdentifier), ...removeIdentifierArgs(sandboxArgs)];
}

function removeFlag(argv: string[], flagName: string): string[] {
  return argv.filter((argument) => argument !== flagName);
}

function removeIdentifierArgs(argv: string[]): string[] {
  const nextArgs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
	    if (argument === "--identifier") {
	      index += 1;
	      continue;
	    }
	    if (argument.startsWith("--identifier=")) {
	      continue;
	    }
    nextArgs.push(argument);
  }

  return nextArgs;
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

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function buildDockerCliEnv(
  runtime: Pick<WorkflowRuntime, "env" | "fileExists" | "mkdirp" | "writeFile">,
  extraEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  runtime.mkdirp(dockerConfigRoot);
  const dockerConfigPath = join(dockerConfigRoot, "config.json");
  if (!runtime.fileExists(dockerConfigPath)) {
    runtime.writeFile(dockerConfigPath, '{"auths": {}}\n');
  }

  return {
    ...runtime.env,
    DOCKER_CONFIG: dockerConfigRoot,
    ...extraEnv,
  };
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
    listDir: (path) => readdirSync(path),
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    nowIso: () => new Date().toISOString(),
    readFile: (path) => readFileSync(path, "utf8"),
    removeFile: (path) => {
      unlinkSync(path);
    },
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
