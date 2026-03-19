import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadProjectEnvFiles, normalizeOptionalString } from "./project-env.mjs";

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
export const requiredSandboxAppEnvNames = [
  "APP_BASE_URL",
  "STRIPE_PREMIUM_PRICE_ID",
  "GAME_DAY_RECAP_MODEL_ID",
] as const;

export type PredictorTargetName = (typeof predictorTargetNames)[number];

export type PredictorTargetPin = {
  artifactPrefix: string;
  releaseId: string;
  updatedAt: string;
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

export function loadDeployWorkflowEnv(
  envProcess: EnvProcessLike = process,
): {
  appEnvPath: string;
  deployEnvPath: string;
} {
  const deployEnvPath = loadDeployLocalEnvFile(workspaceRoot, envProcess);
  loadProjectEnvFiles(
    projectRoot,
    envProcess as Parameters<typeof loadProjectEnvFiles>[1],
  );

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

export function readPredictorTargetPins(
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
): Partial<Record<PredictorTargetName, PredictorTargetPin>> {
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

  return parsed as Partial<Record<PredictorTargetName, PredictorTargetPin>>;
}

export function writePredictorTargetPin(
  targetName: PredictorTargetName,
  pin: PredictorTargetPin,
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<
    PinRuntime,
    "fileExists" | "mkdirp" | "readFile" | "writeFile"
  > = createDefaultPinRuntime(),
): Partial<Record<PredictorTargetName, PredictorTargetPin>> {
  const currentPins = readPredictorTargetPins(filePath, runtime);
  const nextPins = {
    ...currentPins,
    [targetName]: pin,
  };
  runtime.mkdirp(dirname(filePath));
  runtime.writeFile(filePath, `${JSON.stringify(nextPins, null, 2)}\n`);
  return nextPins;
}

export function inspectPredictorTargetPin(
  targetName: PredictorTargetName,
  filePath: string = resolvePredictorTargetsFilePath(),
  runtime: Pick<PinRuntime, "fileExists" | "readFile"> = createDefaultPinRuntime(),
): PredictorTargetInspection {
  if (!runtime.fileExists(filePath)) {
    return {
      message: `Predictor pin file is missing: ${filePath}`,
      status: "missing",
    };
  }

  let pins: Partial<Record<PredictorTargetName, PredictorTargetPin>>;
  try {
    pins = readPredictorTargetPins(filePath, runtime);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "invalid",
    };
  }

  const pin = pins[targetName];
  if (!pin) {
    return {
      message: `Predictor pin '${targetName}' is not defined in ${filePath}.`,
      status: "missing",
    };
  }

  const releaseId = normalizeOptionalString(pin.releaseId);
  if (!releaseId) {
    return {
      message: `Predictor pin '${targetName}' is missing releaseId.`,
      status: "invalid",
    };
  }

  const artifactPrefix = normalizeOptionalString(pin.artifactPrefix);
  if (!artifactPrefix) {
    return {
      message: `Predictor pin '${targetName}' is missing artifactPrefix.`,
      status: "invalid",
    };
  }

  if (!isAbsolute(artifactPrefix)) {
    return {
      message: `Predictor pin '${targetName}' must use an absolute artifactPrefix: ${artifactPrefix}`,
      status: "invalid",
    };
  }

  const updatedAt = normalizeOptionalString(pin.updatedAt);
  if (!updatedAt) {
    return {
      message: `Predictor pin '${targetName}' is missing updatedAt.`,
      status: "invalid",
    };
  }

  const modelPath = `${artifactPrefix}_model.pkl`;
  const configPath = `${artifactPrefix}_config.pkl`;
  if (!runtime.fileExists(modelPath)) {
    return {
      message: `Predictor pin '${targetName}' points to a missing model file: ${modelPath}`,
      status: "invalid",
    };
  }
  if (!runtime.fileExists(configPath)) {
    return {
      message: `Predictor pin '${targetName}' points to a missing config file: ${configPath}`,
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
): PredictorTargetPin {
  const inspection = inspectPredictorTargetPin(targetName, filePath, runtime);
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
