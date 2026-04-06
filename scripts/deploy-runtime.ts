import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadProjectEnvFiles, normalizeOptionalString } from "./project-env.mjs";
import { normalizeSandboxIdentifier } from "./shared-infra-bootstrap.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));

export const projectRoot = join(currentDir, "..");
export const workspaceRoot = join(projectRoot, "..");
export const machineLearningRoot = join(workspaceRoot, "bb-machine-learning");
export const deployEnvFileName = ".env.deploy.local";
export const deployEnvTemplateFileName = ".env.deploy.local.example";
export const sandboxSecretName = "BB_CONNECTION_ENCRYPTION_SECRET";
export const expectedAwsAccount = "427377913956";
export const defaultAwsRegion = "us-east-1";
export const predictorTargetNames = ["sandbox", "dev"] as const;
export const opponentForecastTargetNames = ["sandbox", "dev"] as const;
export const requiredSandboxAppEnvNames = [
  "APP_BASE_URL",
  "STRIPE_PREMIUM_PRICE_ID",
  "GAME_DAY_RECAP_MODEL_ID",
] as const;

export type PredictorTargetName = (typeof predictorTargetNames)[number];
export type OpponentForecastTargetName =
  (typeof opponentForecastTargetNames)[number];

export type PredictorTargetPin = {
  artifactPrefix: string;
  releaseId: string;
  updatedAt: string;
};

export type PredictorTargetPinsFile = {
  dev?: PredictorTargetPin;
  sandbox?: PredictorTargetPin;
  sandboxes?: Record<string, PredictorTargetPin>;
};

export type OpponentForecastTargetPin = {
  datasetRoot: string;
  releaseId: string;
  updatedAt: string;
};

export type OpponentForecastTargetPinsFile = {
  dev?: OpponentForecastTargetPin;
  sandbox?: OpponentForecastTargetPin;
  sandboxes?: Record<string, OpponentForecastTargetPin>;
};

type SandboxTargetPinOptions = {
  sandboxIdentifier?: string | null;
};

type EnvProcessLike = {
  env: NodeJS.ProcessEnv;
  loadEnvFile: (path: string) => void;
};

type PinRuntime = {
  fileExists: (path: string) => boolean;
  mkdirp: (path: string) => void;
  nowIso: () => string;
  readFile: (path: string) => string;
  userName: () => string;
  writeFile: (path: string, contents: string) => void;
};

export type PredictorTargetInspection =
  | {
      message: string;
      status: "invalid" | "missing";
    }
  | {
      configPath: string;
      modelPath: string;
      pin: PredictorTargetPin;
      status: "ready";
    };

export type OpponentForecastTargetInspection =
  | {
      message: string;
      status: "invalid" | "missing";
    }
  | {
      labelsPath: string;
      pin: OpponentForecastTargetPin;
      prestatePath: string;
      status: "ready";
    };

export function resolveDeployEnvFilePath(
  rootPath: string = workspaceRoot,
): string {
  return join(rootPath, deployEnvFileName);
}

export function resolveDeployEnvTemplatePath(
  rootPath: string = workspaceRoot,
): string {
  return join(rootPath, deployEnvTemplateFileName);
}

export function resolvePredictorTargetsFilePath(
  machineLearningRootPath: string = machineLearningRoot,
): string {
  return join(
    machineLearningRootPath,
    "dist",
    "matchup-predictor",
    "targets.local.json",
  );
}

export function resolveOpponentForecastTargetsFilePath(
  machineLearningRootPath: string = machineLearningRoot,
): string {
  return join(
    machineLearningRootPath,
    "dist",
    "opponent-forecast",
    "targets.local.json",
  );
}

export function loadDeployLocalEnvFile(
  rootPath: string = workspaceRoot,
  envProcess: EnvProcessLike = process,
): string {
  const envFilePath = resolveDeployEnvFilePath(rootPath);
  if (existsSync(envFilePath)) {
    envProcess.loadEnvFile(envFilePath);
  }

  return envFilePath;
}

export function loadDeployWorkflowEnv(): {
  appEnvPath: string;
  deployEnvPath: string;
} {
  const deployEnvPath = loadDeployLocalEnvFile(workspaceRoot, process);
  loadProjectEnvFiles(projectRoot);

  return {
    appEnvPath: join(projectRoot, ".env"),
    deployEnvPath,
  };
}

export function createPredictorTargetPin(
  releaseId: string,
  artifactPrefix: string,
  runtime: Pick<PinRuntime, "nowIso"> = createDefaultPinRuntime(),
): PredictorTargetPin {
  return {
    artifactPrefix: artifactPrefix.trim(),
    releaseId: releaseId.trim(),
    updatedAt: runtime.nowIso(),
  };
}

export function createOpponentForecastTargetPin(
  releaseId: string,
  datasetRoot: string,
  runtime: Pick<PinRuntime, "nowIso"> = createDefaultPinRuntime(),
): OpponentForecastTargetPin {
  return {
    datasetRoot: datasetRoot.trim(),
    releaseId: releaseId.trim(),
    updatedAt: runtime.nowIso(),
  };
}

export function readPredictorTargetPins(
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
): PredictorTargetPinsFile {
  if (!runtime.fileExists(filePath)) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(runtime.readFile(filePath));
  } catch (error) {
    throw new Error(
      `Predictor target pin file is not valid JSON: ${filePath}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Predictor target pin file must contain an object: ${filePath}.`);
  }

  return parsed as PredictorTargetPinsFile;
}

export function writePredictorTargetPin(
  targetName: PredictorTargetName,
  pin: PredictorTargetPin,
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<
    PinRuntime,
    "fileExists" | "mkdirp" | "readFile" | "writeFile"
  > = createDefaultPinRuntime(),
  options: SandboxTargetPinOptions = {},
): PredictorTargetPinsFile {
  const currentPins = readPredictorTargetPins(filePath, runtime);
  const nextPins: PredictorTargetPinsFile =
    targetName === "sandbox"
      ? {
          ...currentPins,
          sandboxes: {
            ...readSandboxScopedPins<PredictorTargetPin>(currentPins.sandboxes),
            [resolveRequiredSandboxPinIdentifier(options)]: pin,
          },
        }
      : {
          ...currentPins,
          [targetName]: pin,
        };
  if (targetName === "sandbox" && "sandbox" in nextPins) {
    delete nextPins.sandbox;
  }
  runtime.mkdirp(dirname(filePath));
  runtime.writeFile(filePath, `${JSON.stringify(nextPins, null, 2)}\n`);
  return nextPins;
}

export function readOpponentForecastTargetPins(
  filePath: string = resolveOpponentForecastTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
): OpponentForecastTargetPinsFile {
  if (!runtime.fileExists(filePath)) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(runtime.readFile(filePath));
  } catch (error) {
    throw new Error(
      `Opponent forecast target pin file is not valid JSON: ${filePath}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Opponent forecast target pin file must contain an object: ${filePath}.`,
    );
  }

  return parsed as OpponentForecastTargetPinsFile;
}

export function writeOpponentForecastTargetPin(
  targetName: OpponentForecastTargetName,
  pin: OpponentForecastTargetPin,
  filePath: string = resolveOpponentForecastTargetsFilePath(),
  runtime: Pick<
    PinRuntime,
    "fileExists" | "mkdirp" | "readFile" | "writeFile"
  > = createDefaultPinRuntime(),
  options: SandboxTargetPinOptions = {},
): OpponentForecastTargetPinsFile {
  const currentPins = readOpponentForecastTargetPins(filePath, runtime);
  const nextPins: OpponentForecastTargetPinsFile =
    targetName === "sandbox"
      ? {
          ...currentPins,
          sandboxes: {
            ...readSandboxScopedPins<OpponentForecastTargetPin>(
              currentPins.sandboxes,
            ),
            [resolveRequiredSandboxPinIdentifier(options)]: pin,
          },
        }
      : {
          ...currentPins,
          [targetName]: pin,
        };
  if (targetName === "sandbox" && "sandbox" in nextPins) {
    delete nextPins.sandbox;
  }
  runtime.mkdirp(dirname(filePath));
  runtime.writeFile(filePath, `${JSON.stringify(nextPins, null, 2)}\n`);
  return nextPins;
}

export function inspectPredictorTargetPin(
  targetName: PredictorTargetName,
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
  options: SandboxTargetPinOptions = {},
): PredictorTargetInspection {
  if (!runtime.fileExists(filePath)) {
    return {
      message: `Predictor pin file is missing: ${filePath}`,
      status: "missing",
    };
  }

  let pins: PredictorTargetPinsFile;
  try {
    pins = readPredictorTargetPins(filePath, runtime);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "invalid",
    };
  }

  const targetLabel = formatPinnedTargetName(targetName, options);
  const pin =
    targetName === "sandbox"
      ? resolveSandboxScopedPinEntry(pins.sandboxes, pins.sandbox, options)
      : pins[targetName];
  if (!pin) {
    return {
      message: `Predictor pin '${targetLabel}' is not defined in ${filePath}.`,
      status: "missing",
    };
  }

  const releaseId = normalizeOptionalString(pin.releaseId);
  if (!releaseId) {
    return {
      message: `Predictor pin '${targetLabel}' is missing releaseId.`,
      status: "invalid",
    };
  }

  const artifactPrefix = normalizeOptionalString(pin.artifactPrefix);
  if (!artifactPrefix) {
    return {
      message: `Predictor pin '${targetLabel}' is missing artifactPrefix.`,
      status: "invalid",
    };
  }

  if (!isAbsolute(artifactPrefix)) {
    return {
      message: `Predictor pin '${targetLabel}' must use an absolute artifactPrefix: ${artifactPrefix}`,
      status: "invalid",
    };
  }

  const updatedAt = normalizeOptionalString(pin.updatedAt);
  if (!updatedAt) {
    return {
      message: `Predictor pin '${targetLabel}' is missing updatedAt.`,
      status: "invalid",
    };
  }

  const modelPath = `${artifactPrefix}_model.ubj`;
  const configPath = `${artifactPrefix}_config.json`;
  if (!runtime.fileExists(modelPath)) {
    return {
      message: `Predictor pin '${targetLabel}' points to a missing model file: ${modelPath}`,
      status: "invalid",
    };
  }
  if (!runtime.fileExists(configPath)) {
    return {
      message: `Predictor pin '${targetLabel}' points to a missing config file: ${configPath}`,
      status: "invalid",
    };
  }

  return {
    configPath,
    modelPath,
    pin: {
      artifactPrefix,
      releaseId,
      updatedAt,
    },
    status: "ready",
  };
}

export function resolvePredictorTargetPin(
  targetName: PredictorTargetName,
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
  options: SandboxTargetPinOptions = {},
): PredictorTargetPin {
  const inspection = inspectPredictorTargetPin(targetName, filePath, runtime, options);
  if (inspection.status !== "ready") {
    throw new Error(inspection.message);
  }

  return inspection.pin;
}

export function inspectOpponentForecastTargetPin(
  targetName: OpponentForecastTargetName,
  filePath: string = resolveOpponentForecastTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
  options: SandboxTargetPinOptions = {},
): OpponentForecastTargetInspection {
  if (!runtime.fileExists(filePath)) {
    return {
      message: `Opponent forecast pin file is missing: ${filePath}`,
      status: "missing",
    };
  }

  let pins: OpponentForecastTargetPinsFile;
  try {
    pins = readOpponentForecastTargetPins(filePath, runtime);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "invalid",
    };
  }

  const targetLabel = formatPinnedTargetName(targetName, options);
  const pin =
    targetName === "sandbox"
      ? resolveSandboxScopedPinEntry(pins.sandboxes, pins.sandbox, options)
      : pins[targetName];
  if (!pin) {
    return {
      message: `Opponent forecast pin '${targetLabel}' is not defined in ${filePath}.`,
      status: "missing",
    };
  }

  const releaseId = normalizeOptionalString(pin.releaseId);
  if (!releaseId) {
    return {
      message: `Opponent forecast pin '${targetLabel}' is missing releaseId.`,
      status: "invalid",
    };
  }

  const datasetRoot = normalizeOptionalString(pin.datasetRoot);
  if (!datasetRoot) {
    return {
      message: `Opponent forecast pin '${targetLabel}' is missing datasetRoot.`,
      status: "invalid",
    };
  }

  if (!isAbsolute(datasetRoot)) {
    return {
      message: `Opponent forecast pin '${targetLabel}' must use an absolute datasetRoot: ${datasetRoot}`,
      status: "invalid",
    };
  }

  if (!runtime.fileExists(datasetRoot)) {
    return {
      message: `Opponent forecast pin '${targetLabel}' points to a missing dataset root: ${datasetRoot}`,
      status: "invalid",
    };
  }

  const updatedAt = normalizeOptionalString(pin.updatedAt);
  if (!updatedAt) {
    return {
      message: `Opponent forecast pin '${targetLabel}' is missing updatedAt.`,
      status: "invalid",
    };
  }

  const prestatePath = join(datasetRoot, "team_match_prestate.parquet");
  const labelsPath = join(datasetRoot, "team_match_labels.parquet");
  if (!runtime.fileExists(prestatePath)) {
    return {
      message: `Opponent forecast pin '${targetLabel}' points to a missing prestate file: ${prestatePath}`,
      status: "invalid",
    };
  }
  if (!runtime.fileExists(labelsPath)) {
    return {
      message: `Opponent forecast pin '${targetLabel}' points to a missing labels file: ${labelsPath}`,
      status: "invalid",
    };
  }

  return {
    labelsPath,
    pin: {
      datasetRoot,
      releaseId,
      updatedAt,
    },
    prestatePath,
    status: "ready",
  };
}

export function resolveOpponentForecastTargetPin(
  targetName: OpponentForecastTargetName,
  filePath: string = resolveOpponentForecastTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
  options: SandboxTargetPinOptions = {},
): OpponentForecastTargetPin {
  const inspection = inspectOpponentForecastTargetPin(
    targetName,
    filePath,
    runtime,
    options,
  );
  if (inspection.status !== "ready") {
    throw new Error(inspection.message);
  }

  return inspection.pin;
}

export function defaultSandboxUserName(
  runtime: Pick<PinRuntime, "userName"> = createDefaultPinRuntime(),
): string {
  return normalizeOptionalString(runtime.userName()) ?? "local";
}

function resolveSandboxScopedPinEntry<T>(
  scopedPins: unknown,
  legacyPin: T | undefined,
  options: SandboxTargetPinOptions,
): T | undefined {
  const sandboxIdentifier = normalizeSandboxPinIdentifier(options);
  if (sandboxIdentifier) {
    const matchingPin = readSandboxScopedPins<T>(scopedPins)[sandboxIdentifier];
    if (matchingPin) {
      return matchingPin;
    }
  }

  return legacyPin;
}

function readSandboxScopedPins<T>(value: unknown): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, T>;
}

function resolveRequiredSandboxPinIdentifier(
  options: SandboxTargetPinOptions,
): string {
  const sandboxIdentifier = normalizeSandboxPinIdentifier(options);
  if (!sandboxIdentifier) {
    throw new Error("Sandbox target pin writes require sandboxIdentifier.");
  }

  return sandboxIdentifier;
}

function formatPinnedTargetName(
  targetName: PredictorTargetName | OpponentForecastTargetName,
  options: SandboxTargetPinOptions,
): string {
  if (targetName !== "sandbox") {
    return targetName;
  }

  const sandboxIdentifier = normalizeSandboxPinIdentifier(options);
  return sandboxIdentifier ? `sandbox:${sandboxIdentifier}` : "sandbox";
}

function normalizeSandboxPinIdentifier(
  options: SandboxTargetPinOptions,
): string | null {
  const sandboxIdentifier = normalizeOptionalString(options.sandboxIdentifier);
  return sandboxIdentifier ? normalizeSandboxIdentifier(sandboxIdentifier) : null;
}

function createDefaultPinRuntime(): PinRuntime {
  return {
    fileExists: existsSync,
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    nowIso: () => new Date().toISOString(),
    readFile: (path) => readFileSync(path, "utf8"),
    userName: () => os.userInfo().username || "local",
    writeFile: (path, contents) => {
      writeFileSync(path, contents, "utf8");
    },
  };
}
