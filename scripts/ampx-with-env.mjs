import { spawn } from "node:child_process";
import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CloudFormationClient,
  DescribeStackResourceCommand,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

import {
  loadProjectEnvFiles,
  normalizeOptionalString,
} from "./project-env.mjs";
import {
  assertSandboxPredictorReady,
  bootstrapSandboxSharedInfra,
  ensureResolvedSandboxIdentifierArgv,
  resolveSandboxEnvironmentName,
  shouldBootstrapSandboxSharedInfra,
} from "./shared-infra-bootstrap.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");
const workspaceRoot = join(projectRoot, "..");
const amplifyOutputsFile = join(projectRoot, "amplify_outputs.json");
const dockerConfigRoot = join(
  workspaceRoot,
  "bb-machine-learning",
  "dist",
  ".docker-cli",
);
const billingNestedStackPath =
  "billing-integration.NestedStack/billing-integration.NestedStackResource";
const billingWebhookOutputKey = "BillingWebhookUrl";
const sandboxManagementSubcommands = new Set(["delete", "secret", "seed"]);
const sandboxWatchDirFlag = "--dir-to-watch";
const sandboxExcludeFlag = "--exclude";
const sandboxDefaultWatchDir = ".";
const sandboxDefaultExcludePaths = [
  "amplify_outputs.json",
  ".amplify",
  ".next",
  "node_modules",
  "cdk.out",
  "app",
  "public",
  "tests",
  "docs",
  "bb-api-fixtures",
];
const sandboxStreamLogsFlag = "--stream-function-logs";
const debounceMs = 750;

export function shouldWatchSandboxOutputs(argv) {
  if (argv[0] !== "sandbox") {
    return false;
  }

  if (argv.includes("--once")) {
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

export function applySandboxDefaults(argv) {
  if (!shouldWatchSandboxOutputs(argv)) {
    return [...argv];
  }

  const sandboxArgv = hasExplicitWatchSettings(argv)
    ? [...argv]
    : [
        ...argv,
        sandboxWatchDirFlag,
        sandboxDefaultWatchDir,
        ...sandboxDefaultExcludePaths.flatMap((path) => [
          sandboxExcludeFlag,
          path,
        ]),
      ];

  if (hasExplicitStreamLogsSetting(sandboxArgv)) {
    return sandboxArgv;
  }

  return [...sandboxArgv, sandboxStreamLogsFlag];
}

export function resolveRootStackNameFromManifest(manifest) {
  const artifacts = asRecord(manifest?.artifacts, "CDK manifest artifacts");
  for (const [artifactName, artifact] of Object.entries(artifacts)) {
    if (artifact?.type === "aws:cloudformation:stack") {
      return artifactName;
    }
  }

  throw new Error(
    "Unable to find the synthesized root sandbox stack in manifest.json.",
  );
}

export function resolveRootTemplateFileFromManifest(manifest, rootStackName) {
  const artifacts = asRecord(manifest?.artifacts, "CDK manifest artifacts");
  const artifact = asRecord(artifacts[rootStackName], "CDK stack artifact");
  const templateFile = artifact?.properties?.templateFile;
  if (typeof templateFile !== "string" || !templateFile.trim()) {
    throw new Error("Unable to find the synthesized root stack template file.");
  }

  return templateFile;
}

export function resolveBillingNestedStackLogicalId(rootTemplate) {
  const resources = asRecord(rootTemplate?.Resources, "root stack resources");
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource?.Type !== "AWS::CloudFormation::Stack") {
      continue;
    }

    const cdkPath = resource?.Metadata?.["aws:cdk:path"];
    if (
      typeof cdkPath === "string" &&
      cdkPath.includes(billingNestedStackPath)
    ) {
      return logicalId;
    }
  }

  throw new Error(
    "Unable to find the billing-integration nested stack resource.",
  );
}

export function resolveAwsRegion(amplifyOutputs, env = process.env) {
  const region =
    normalizeOptionalString(amplifyOutputs?.data?.aws_region) ??
    normalizeOptionalString(amplifyOutputs?.auth?.aws_region) ??
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION);
  if (!region) {
    throw new Error(
      "Unable to determine the AWS region for sandbox stack lookups.",
    );
  }

  return region;
}

export function extractBillingWebhookUrl(outputs) {
  if (!Array.isArray(outputs)) {
    throw new Error("CloudFormation stack outputs were not an array.");
  }

  const match = outputs.find(
    (output) =>
      output &&
      typeof output === "object" &&
      output.OutputKey === billingWebhookOutputKey &&
      typeof output.OutputValue === "string" &&
      output.OutputValue.trim(),
  );
  if (!match) {
    throw new Error(
      "BillingWebhookUrl was not present in the billing stack outputs.",
    );
  }

  return match.OutputValue.trim();
}

export function createWebhookUrlReporter({
  debounceMilliseconds = debounceMs,
  lookupWebhookUrl,
  log = console.log,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout,
  warn = console.warn,
}) {
  let lastPrintedUrl = null;
  let pendingTimer = null;
  let isResolving = false;
  let rerunRequested = false;

  async function reportIfChanged() {
    if (isResolving) {
      rerunRequested = true;
      return;
    }

    isResolving = true;
    try {
      const webhookUrl = await lookupWebhookUrl();
      if (webhookUrl !== lastPrintedUrl) {
        lastPrintedUrl = webhookUrl;
        log(`Stripe webhook URL: ${webhookUrl}`);
      }
    } catch (error) {
      warn(
        `Stripe webhook URL unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      isResolving = false;
      if (rerunRequested) {
        rerunRequested = false;
        await reportIfChanged();
      }
    }
  }

  function schedule() {
    if (pendingTimer !== null) {
      cancelTimeout(pendingTimer);
    }

    pendingTimer = scheduleTimeout(() => {
      pendingTimer = null;
      void reportIfChanged();
    }, debounceMilliseconds);
  }

  function close() {
    if (pendingTimer !== null) {
      cancelTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  return {
    close,
    getLastPrintedUrl: () => lastPrintedUrl,
    reportIfChanged,
    schedule,
  };
}

export function startSandboxOutputsWatcher({
  onOutputsChanged,
  watchPath = projectRoot,
  watchDirectory = defaultWatchDirectory,
}) {
  return watchDirectory(watchPath, (_eventType, fileName) => {
    if (normalizeWatchedFilename(fileName) === basename(amplifyOutputsFile)) {
      onOutputsChanged();
    }
  });
}

export async function resolveBillingWebhookUrl(
  projectRootPath = projectRoot,
  runtime = createDefaultLookupRuntime(),
) {
  const amplifyOutputs = await runtime.readJson(
    join(projectRootPath, basename(amplifyOutputsFile)),
  );
  const region = resolveAwsRegion(amplifyOutputs, runtime.env);
  const manifest = await runtime.readJson(
    join(projectRootPath, ".amplify", "artifacts", "cdk.out", "manifest.json"),
  );
  const rootStackName = resolveRootStackNameFromManifest(manifest);
  const rootTemplateFile = resolveRootTemplateFileFromManifest(
    manifest,
    rootStackName,
  );
  const rootTemplate = await runtime.readJson(
    join(projectRootPath, ".amplify", "artifacts", "cdk.out", rootTemplateFile),
  );
  const billingLogicalId = resolveBillingNestedStackLogicalId(rootTemplate);
  const nestedStackId = await runtime.describeNestedStackId({
    logicalResourceId: billingLogicalId,
    region,
    rootStackName,
  });
  const outputs = await runtime.describeStackOutputs({
    region,
    stackName: nestedStackId,
  });

  return extractBillingWebhookUrl(outputs);
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();

  const explicitSandboxArgv = ensureResolvedSandboxIdentifierArgv(argv);
  const sharedInfraBootstrap = bootstrapSandboxSharedInfra(explicitSandboxArgv);
  assertSandboxPredictorReady(explicitSandboxArgv);
  const sandboxArgv = applySandboxDefaults(explicitSandboxArgv);
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const childEnv = buildDockerCliEnv();
  if (sharedInfraBootstrap) {
    childEnv.BB_SHARED_ENVIRONMENT_NAME = sharedInfraBootstrap.environmentName;
  } else if (shouldBootstrapSandboxSharedInfra(explicitSandboxArgv)) {
    // Keep the sandbox environment identity stable even when infra already exists.
    childEnv.BB_SHARED_ENVIRONMENT_NAME =
      childEnv.BB_SHARED_ENVIRONMENT_NAME ??
      resolveSandboxEnvironmentName(explicitSandboxArgv);
  }
  const child = spawn(command, ["ampx", ...sandboxArgv], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  });

  const shouldWatch = shouldWatchSandboxOutputs(explicitSandboxArgv);
  const reporter = shouldWatch
    ? createWebhookUrlReporter({
        lookupWebhookUrl: () => resolveBillingWebhookUrl(projectRoot),
      })
    : null;
  const watcher = reporter
    ? startSandboxOutputsWatcher({
        onOutputsChanged: () => reporter.schedule(),
      })
    : null;

  child.on("exit", (code, signal) => {
    void finalizeSandboxProcess({
      code,
      reporter,
      signal,
      watcher,
    });
  });

  child.on("error", (error) => {
    if (watcher) {
      watcher.close();
    }

    if (reporter) {
      reporter.close();
    }

    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

async function finalizeSandboxProcess({ code, reporter, signal, watcher }) {
  watcher?.close();
  reporter?.close();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0 && reporter) {
    await reporter.reportIfChanged();
  }

  process.exit(code ?? 1);
}

function loadLocalEnv() {
  loadProjectEnvFiles(projectRoot);
}

function buildDockerCliEnv() {
  mkdirSync(dockerConfigRoot, { recursive: true });
  const configPath = join(dockerConfigRoot, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, '{"auths": {}}\n', "utf8");
  }

  return {
    ...process.env,
    DOCKER_CONFIG: dockerConfigRoot,
  };
}

function defaultWatchDirectory(pathToWatch, listener) {
  return watch(pathToWatch, listener);
}

function normalizeWatchedFilename(fileName) {
  if (typeof fileName === "string") {
    return basename(fileName);
  }

  if (fileName instanceof Buffer) {
    return basename(fileName.toString("utf8"));
  }

  return null;
}

function hasExplicitStreamLogsSetting(argv) {
  return argv.some(
    (argument) =>
      argument === sandboxStreamLogsFlag ||
      argument === `--no-${sandboxStreamLogsFlag.slice(2)}` ||
      argument.startsWith(`${sandboxStreamLogsFlag}=`),
  );
}

function hasExplicitWatchSettings(argv) {
  return argv.some(
    (argument) =>
      argument === sandboxWatchDirFlag ||
      argument.startsWith(`${sandboxWatchDirFlag}=`) ||
      argument === sandboxExcludeFlag ||
      argument.startsWith(`${sandboxExcludeFlag}=`),
  );
}

function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`);
  }

  return value;
}

function createDefaultLookupRuntime() {
  return {
    describeNestedStackId: async ({
      logicalResourceId,
      region,
      rootStackName,
    }) => {
      const client = new CloudFormationClient({ region });
      const response = await client.send(
        new DescribeStackResourceCommand({
          LogicalResourceId: logicalResourceId,
          StackName: rootStackName,
        }),
      );
      const nestedStackId = normalizeOptionalString(
        response.StackResourceDetail?.PhysicalResourceId,
      );
      if (!nestedStackId) {
        throw new Error(
          "Unable to resolve the physical billing nested stack id.",
        );
      }

      return nestedStackId;
    },
    describeStackOutputs: async ({ region, stackName }) => {
      const client = new CloudFormationClient({ region });
      const response = await client.send(
        new DescribeStacksCommand({
          StackName: stackName,
        }),
      );
      return response.Stacks?.[0]?.Outputs ?? [];
    },
    env: process.env,
    readJson: async (filePath) => JSON.parse(await readFile(filePath, "utf8")),
  };
}

const entrypointHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entrypointHref === import.meta.url) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
