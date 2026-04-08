import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as publicAppOriginModule from "../lib/env/public-app-origin.ts";
import * as maintenanceEnvironmentModule from "../lib/maintenance/environment.ts";
import { envContract } from "./env-contract.mjs";
import { normalizeOptionalString } from "./project-env.mjs";

const deriveAmplifyAppOrigin =
  publicAppOriginModule.deriveAmplifyAppOrigin ??
  publicAppOriginModule.default?.deriveAmplifyAppOrigin;
const resolveMaintenanceEnvironmentName =
  maintenanceEnvironmentModule.resolveMaintenanceEnvironmentName ??
  maintenanceEnvironmentModule.default?.resolveMaintenanceEnvironmentName;

if (typeof deriveAmplifyAppOrigin !== "function") {
  throw new Error(
    "Unable to resolve deriveAmplifyAppOrigin from public-app-origin.ts.",
  );
}
if (typeof resolveMaintenanceEnvironmentName !== "function") {
  throw new Error(
    "Unable to resolve resolveMaintenanceEnvironmentName from maintenance/environment.ts.",
  );
}

export const hostedRuntimeEnvFileName = ".env.production";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(currentDir, "..");
export const hostedRuntimeEnvFilePath = join(
  projectRoot,
  hostedRuntimeEnvFileName,
);

function formatEnvValue(value) {
  if (/[\s#"\\]/.test(value) || value.includes("'")) {
    return JSON.stringify(value);
  }

  return value;
}

function listHostedPlainEnvNames(contract = envContract) {
  return [...contract.plain.required, ...contract.plain.optional].map(
    (entry) => entry.name,
  );
}

export function resolveHostedRuntimeEnvEntries(
  env = process.env,
  contract = envContract,
) {
  const appBaseUrl = normalizeOptionalString(env.APP_BASE_URL);
  if (!appBaseUrl) {
    throw new Error(
      "APP_BASE_URL must be configured before building hosted Next.js artifacts.",
    );
  }

  const entries = new Map();

  for (const name of listHostedPlainEnvNames(contract)) {
    const value = normalizeOptionalString(env[name]);
    if (value) {
      entries.set(name, value);
    }
  }

  entries.set("APP_BASE_URL", appBaseUrl);
  entries.set(
    "AMPLIFY_APP_ORIGIN",
    deriveAmplifyAppOrigin({ APP_BASE_URL: appBaseUrl }),
  );
  entries.set(
    "MAINTENANCE_ENVIRONMENT_NAME",
    resolveMaintenanceEnvironmentName(env),
  );

  for (const name of Object.keys(env).sort()) {
    if (!name.startsWith("NEXT_PUBLIC_")) {
      continue;
    }

    const value = normalizeOptionalString(env[name]);
    if (value) {
      entries.set(name, value);
    }
  }

  return [...entries.entries()].map(([name, value]) => ({
    name,
    value,
  }));
}

export function renderHostedRuntimeEnvFile(
  env = process.env,
  contract = envContract,
) {
  return `${resolveHostedRuntimeEnvEntries(env, contract)
    .map(({ name, value }) => `${name}=${formatEnvValue(value)}`)
    .join("\n")}\n`;
}

export function writeHostedRuntimeEnvFile(
  filePath = hostedRuntimeEnvFilePath,
  env = process.env,
  contract = envContract,
) {
  const source = renderHostedRuntimeEnvFile(env, contract);
  writeFileSync(filePath, source, "utf8");
  return {
    filePath,
    source,
  };
}

export function main() {
  const { filePath } = writeHostedRuntimeEnvFile();
  console.log(`Wrote hosted Next.js runtime env file: ${filePath}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
