import { spawnSync as defaultSpawnSync } from "node:child_process";
import {
  existsSync as defaultExistsSync,
  readFileSync as defaultReadFileSync,
  readdirSync as defaultReaddirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const allowMissingGeneratedEnvFlag = "--allow-missing-generated-env";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(currentDir, "..");
export const amplifySourceDir = join(repoRoot, "amplify");
export const generatedEnvDir = join(repoRoot, ".amplify", "generated", "env");
export const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");

export const missingGeneratedEnvMessage = [
  "Amplify generated env modules are missing or stale.",
  "Standalone Amplify backend typecheck requires generated env coverage for every `$amplify/env/<resource>` import.",
  "Run `npm run sandbox:once` or `npx ampx pipeline-deploy ...`, then rerun `npm run typecheck:amplify`.",
].join(" ");

export const skippedGeneratedEnvMessage = [
  "Amplify generated env modules are missing or stale.",
  "Skipping standalone Amplify backend typecheck because generated env modules are unavailable or incomplete.",
  "Run `npm run sandbox:once` or `npx ampx pipeline-deploy ...`, then rerun `npm run typecheck:amplify` for the strict check.",
].join(" ");

const amplifyEnvImportPatterns = [
  /from\s+["']\$amplify\/env\/([^"'`]+)["']/g,
  /import\s*\(\s*["']\$amplify\/env\/([^"'`]+)["']\s*\)/g,
];

export function parseTypecheckAmplifyArgs(argv = process.argv.slice(2)) {
  return {
    allowMissingGeneratedEnv: argv.includes(allowMissingGeneratedEnvFlag),
  };
}

export function formatGeneratedEnvMessage(
  baseMessage,
  missingModuleNames = [],
) {
  const normalizedMissingModuleNames = Array.from(
    new Set(
      missingModuleNames
        .filter((moduleName) => typeof moduleName === "string")
        .map((moduleName) => moduleName.trim())
        .filter((moduleName) => moduleName.length > 0),
    ),
  ).sort();

  if (normalizedMissingModuleNames.length === 0) {
    return baseMessage;
  }

  return `${baseMessage} Missing modules: ${normalizedMissingModuleNames.join(", ")}.`;
}

export function listAmplifySourceFiles(
  rootPath = amplifySourceDir,
  exists = defaultExistsSync,
  readDir = defaultReaddirSync,
) {
  if (!exists(rootPath)) {
    return [];
  }

  const sourceFiles = [];
  const pendingDirectories = [rootPath];

  while (pendingDirectories.length > 0) {
    const currentPath = pendingDirectories.pop();
    if (!currentPath) {
      continue;
    }

    const entries = readDir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (entry.endsWith(".ts")) {
          sourceFiles.push(join(currentPath, entry));
        }
        continue;
      }

      if (entry.isDirectory()) {
        pendingDirectories.push(join(currentPath, entry.name));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".ts")) {
        sourceFiles.push(join(currentPath, entry.name));
      }
    }
  }

  return sourceFiles.sort();
}

export function findAmplifyEnvModuleNames(source) {
  const moduleNames = new Set();

  for (const pattern of amplifyEnvImportPatterns) {
    for (const match of source.matchAll(pattern)) {
      const moduleName = match[1]?.trim();
      if (moduleName) {
        moduleNames.add(moduleName);
      }
    }
  }

  return Array.from(moduleNames).sort();
}

export function collectRequiredGeneratedEnvModuleNames(
  amplifyDir = amplifySourceDir,
  {
    exists = defaultExistsSync,
    readDir = defaultReaddirSync,
    readFile = defaultReadFileSync,
  } = {},
) {
  const requiredModuleNames = new Set();

  for (const sourceFile of listAmplifySourceFiles(amplifyDir, exists, readDir)) {
    const source = readFile(sourceFile, "utf8");
    for (const moduleName of findAmplifyEnvModuleNames(source)) {
      requiredModuleNames.add(moduleName);
    }
  }

  return Array.from(requiredModuleNames).sort();
}

export function listGeneratedEnvModuleNames(
  envDir = generatedEnvDir,
  exists = defaultExistsSync,
  readDir = defaultReaddirSync,
) {
  if (!exists(envDir)) {
    return [];
  }

  const moduleNames = [];
  const entries = readDir(envDir);
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (entry.endsWith(".ts")) {
        moduleNames.push(entry.slice(0, -3));
      }
      continue;
    }

    if (entry.isFile?.() && entry.name.endsWith(".ts")) {
      moduleNames.push(entry.name.slice(0, -3));
    }
  }

  return moduleNames.sort();
}

export function getGeneratedEnvCoverage(
  {
    amplifyDir = amplifySourceDir,
    envDir = generatedEnvDir,
    exists = defaultExistsSync,
    readDir = defaultReaddirSync,
    readFile = defaultReadFileSync,
  } = {},
) {
  const generatedModuleNames = listGeneratedEnvModuleNames(
    envDir,
    exists,
    readDir,
  );
  const requiredModuleNames = collectRequiredGeneratedEnvModuleNames(amplifyDir, {
    exists,
    readDir,
    readFile,
  });
  const generatedModuleNameSet = new Set(generatedModuleNames);
  const missingModuleNames = requiredModuleNames.filter(
    (moduleName) => !generatedModuleNameSet.has(moduleName),
  );

  return {
    generatedModuleNames,
    isComplete:
      generatedModuleNames.length > 0 && missingModuleNames.length === 0,
    missingModuleNames,
    requiredModuleNames,
  };
}

export function hasGeneratedEnvModules(
  envDir = generatedEnvDir,
  exists = defaultExistsSync,
  readDir = defaultReaddirSync,
  amplifyDir = amplifySourceDir,
  readFile = defaultReadFileSync,
) {
  return getGeneratedEnvCoverage({
    amplifyDir,
    envDir,
    exists,
    readDir,
    readFile,
  }).isComplete;
}

export function runAmplifyTypecheck(
  argv = process.argv.slice(2),
  {
    envDir = generatedEnvDir,
    error = console.error,
    exists = defaultExistsSync,
    readDir = defaultReaddirSync,
    readFile = defaultReadFileSync,
    rootDir = repoRoot,
    spawn = defaultSpawnSync,
    warn = console.warn,
    typecheckBinaryPath = tscPath,
  } = {},
) {
  const { allowMissingGeneratedEnv } = parseTypecheckAmplifyArgs(argv);
  const coverage = getGeneratedEnvCoverage({
    amplifyDir: join(rootDir, "amplify"),
    envDir,
    exists,
    readDir,
    readFile,
  });

  if (!coverage.isComplete) {
    if (allowMissingGeneratedEnv) {
      warn(
        formatGeneratedEnvMessage(
          skippedGeneratedEnvMessage,
          coverage.missingModuleNames,
        ),
      );
      return 0;
    }

    error(
      formatGeneratedEnvMessage(
        missingGeneratedEnvMessage,
        coverage.missingModuleNames,
      ),
    );
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
