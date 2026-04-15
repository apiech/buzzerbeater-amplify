import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync as defaultExistsSync, readdirSync as defaultReaddirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const allowMissingGeneratedEnvFlag = "--allow-missing-generated-env";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(currentDir, "..");
export const generatedEnvDir = join(repoRoot, ".amplify", "generated", "env");
export const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");

export const missingGeneratedEnvMessage = [
  "Amplify generated env modules are missing.",
  "Standalone Amplify backend typecheck requires Amplify-generated env modules.",
  "Run `npm run sandbox:once` or `npx ampx pipeline-deploy ...`, then rerun `npm run typecheck:amplify`.",
].join(" ");

export const skippedGeneratedEnvMessage = [
  "Amplify generated env modules are missing.",
  "Skipping standalone Amplify backend typecheck because generated env modules are unavailable.",
  "Run `npm run sandbox:once` or `npx ampx pipeline-deploy ...`, then rerun `npm run typecheck:amplify` for the strict check.",
].join(" ");

export function parseTypecheckAmplifyArgs(argv = process.argv.slice(2)) {
  return {
    allowMissingGeneratedEnv: argv.includes(allowMissingGeneratedEnvFlag),
  };
}

export function hasGeneratedEnvModules(
  envDir = generatedEnvDir,
  exists = defaultExistsSync,
  readDir = defaultReaddirSync,
) {
  return exists(envDir) && readDir(envDir).length > 0;
}

export function runAmplifyTypecheck(
  argv = process.argv.slice(2),
  {
    envDir = generatedEnvDir,
    error = console.error,
    exists = defaultExistsSync,
    readDir = defaultReaddirSync,
    rootDir = repoRoot,
    spawn = defaultSpawnSync,
    warn = console.warn,
    typecheckBinaryPath = tscPath,
  } = {},
) {
  const { allowMissingGeneratedEnv } = parseTypecheckAmplifyArgs(argv);

  if (!hasGeneratedEnvModules(envDir, exists, readDir)) {
    if (allowMissingGeneratedEnv) {
      warn(skippedGeneratedEnvMessage);
      return 0;
    }

    error(missingGeneratedEnvMessage);
    return 1;
  }

  const result = spawn(
    typecheckBinaryPath,
    ["-p", "amplify/tsconfig.json", "--noEmit"],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );

  return result.status ?? 1;
}

export function main(argv = process.argv.slice(2)) {
  return runAmplifyTypecheck(argv);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exit(main());
}
