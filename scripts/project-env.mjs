import { existsSync } from "node:fs";
import { join } from "node:path";

export const localEnvFileName = ".env";
export const matchDataPlaneEnvFileName = ".env.match-data-plane";
export const defaultMatchDataPlaneStackName = "MatchDataPlane";

export function normalizeOptionalString(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

export function resolveLocalEnvFilePath(projectRoot) {
  return join(projectRoot, localEnvFileName);
}

export function resolveMatchDataPlaneEnvFilePath(projectRoot) {
  return join(projectRoot, matchDataPlaneEnvFileName);
}

export function resolveMatchDataPlaneSource(env = process.env) {
  const configuredSource = normalizeOptionalString(env.MATCH_DATA_PLANE_SOURCE);
  if (!configuredSource) {
    return "local";
  }

  const normalizedSource = configuredSource.toLowerCase();
  if (normalizedSource === "local" || normalizedSource === "external") {
    return normalizedSource;
  }

  throw new Error(
    "MATCH_DATA_PLANE_SOURCE must be set to either 'local' or 'external'.",
  );
}

export function resolveMatchDataPlaneStackName(env = process.env) {
  if (resolveMatchDataPlaneSource(env) !== "external") {
    return null;
  }

  return (
    normalizeOptionalString(env.MATCH_DATA_PLANE_STACK_NAME) ??
    defaultMatchDataPlaneStackName
  );
}

export function loadBaseEnvFile(projectRoot, envProcess = process) {
  const envFilePath = resolveLocalEnvFilePath(projectRoot);
  if (existsSync(envFilePath)) {
    envProcess.loadEnvFile(envFilePath);
  }
}

export function loadGeneratedMatchDataPlaneEnvFile(
  projectRoot,
  envProcess = process,
) {
  if (resolveMatchDataPlaneSource(envProcess.env) !== "external") {
    return null;
  }

  const envFilePath = resolveMatchDataPlaneEnvFilePath(projectRoot);
  if (!existsSync(envFilePath)) {
    return null;
  }

  envProcess.loadEnvFile(envFilePath);
  return envFilePath;
}

export function loadProjectEnvFiles(projectRoot, envProcess = process) {
  loadBaseEnvFile(projectRoot, envProcess);
  return loadGeneratedMatchDataPlaneEnvFile(projectRoot, envProcess);
}
