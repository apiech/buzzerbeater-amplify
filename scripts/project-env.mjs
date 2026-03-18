import { existsSync } from "node:fs";
import { join } from "node:path";

export const localEnvFileName = ".env";

export function normalizeOptionalString(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

export function resolveLocalEnvFilePath(projectRoot) {
  return join(projectRoot, localEnvFileName);
}

export function loadBaseEnvFile(projectRoot, envProcess = process) {
  const envFilePath = resolveLocalEnvFilePath(projectRoot);
  if (existsSync(envFilePath)) {
    envProcess.loadEnvFile(envFilePath);
  }
}

export function loadProjectEnvFiles(projectRoot, envProcess = process) {
  loadBaseEnvFile(projectRoot, envProcess);
  return null;
}
