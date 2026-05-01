import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { envContract } from "../scripts/env-contract.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const sourceExtensions = new Set([".js", ".json", ".mjs", ".ts", ".tsx", ".yml"]);

function listFiles(rootPath: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === ".amplify" ||
        entry.name === ".next" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      files.push(...listFiles(entryPath));
      continue;
    }

    if (sourceExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectEnvNames(source: string, options?: { shellStyle?: boolean }): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /\benv\.([A-Z][A-Z0-9_]+)/g,
    /secret\(\s*"([A-Z][A-Z0-9_]+)"/g,
    /addEnvironment\(\s*"([A-Z][A-Z0-9_]+)"/g,
  ];
  if (options?.shellStyle) {
    patterns.push(/\$[{(]?([A-Z][A-Z0-9_]+)[})]?/g);
  }

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }

  return names;
}

test("externally configurable and injected env names are all classified", () => {
  const scannedFiles = [
    ...listFiles(join(repoRoot, "amplify")),
    ...listFiles(join(repoRoot, "scripts")),
    join(repoRoot, "amplify.yml"),
  ];
  const discoveredNames = new Set<string>();

  for (const filePath of scannedFiles) {
    const source = readFileSync(filePath, "utf8");
    for (
      const envName of collectEnvNames(source, {
        shellStyle: filePath.endsWith("amplify.yml"),
      })
    ) {
      discoveredNames.add(envName);
    }
  }

  const documentedNames = new Set(
    [
      ...envContract.plain.required,
      ...envContract.plain.optional,
      ...envContract.generated,
      ...envContract.secrets,
      ...envContract.internal,
      ...envContract.localScripts,
    ].map((entry) => entry.name),
  );
  const runtimeInjectedNames = new Set(
    envContract.runtimeInjected.map((entry) => entry.name),
  );
  const platformProvidedNames = new Set([
    "AMPLIFY_DATA_GRAPHQL_ENDPOINT",
    "AMPLIFY_DATA_MODEL_INTROSPECTION_SCHEMA_BUCKET_NAME",
    "AMPLIFY_DATA_MODEL_INTROSPECTION_SCHEMA_KEY",
  ]);
  const classifiedNames = new Set([
    ...documentedNames,
    ...runtimeInjectedNames,
    ...platformProvidedNames,
  ]);

  const unexpectedNames = [...discoveredNames]
    .filter((name) => !classifiedNames.has(name))
    .sort();

  assert.deepEqual(unexpectedNames, []);
  assert.deepEqual([...runtimeInjectedNames].sort(), [
    "BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME",
    "FEEDBACK_ALERTS_TOPIC_ARN",
    "GAME_DAY_RECAP_STATE_MACHINE_ARN",
    "LEAGUE_HISTORY_BACKFILL_STATE_MACHINE_ARN",
    "LEAGUE_SEASON_SIMULATION_JOB_STATE_MACHINE_ARN",
    "LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY",
    "NEXT_GAME_RECOMMENDATION_JOB_STATE_MACHINE_ARN",
    "OPPONENT_FORECAST_ENDPOINT_NAME",
    "OPPONENT_FORECAST_JOB_STATE_MACHINE_ARN",
    "PREDICTION_ENDPOINT_NAME",
    "PREDICTION_JOB_STATE_MACHINE_ARN",
    "RIVALS_BACKFILL_STATE_MACHINE_ARN",
    "TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN",
  ]);
  assert.equal(documentedNames.has("BB_SHARED_ENVIRONMENT_NAME"), true);
  assert.equal(documentedNames.has("MATCH_STORE_BUCKET_NAME"), true);
  assert.equal(documentedNames.has("MATCH_DATA_PLANE_SOURCE"), false);
  assert.equal(documentedNames.has("MATCH_DATA_PLANE_STACK_NAME"), false);
  assert.equal(documentedNames.has("OPPONENT_FORECAST_ENDPOINT_NAME"), false);
  assert.equal(documentedNames.has("PREDICTION_ENDPOINT_NAME"), false);
});
