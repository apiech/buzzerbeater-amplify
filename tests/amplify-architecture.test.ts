import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const testFilePattern = /\.(?:test|spec)\.[^.]+$/;
const productionSourceRoots = [
  join(repoRoot, "app"),
  join(repoRoot, "amplify"),
  join(repoRoot, "scripts"),
] as const;
const approvedLargeDependencyBags = new Map<string, number>([
  ["app/game-prediction-state.ts", 10],
  ["amplify/data/_backend/billing.ts", 4],
  ["amplify/data/_backend/game-day-recap.ts", 19],
  ["amplify/data/_backend/league-history.ts", 16],
  ["amplify/data/_backend/lineup-helper.ts", 4],
  ["amplify/data/_backend/match-store.ts", 5],
  ["amplify/data/_backend/next-game-recommendation.ts", 31],
  ["amplify/data/_backend/opponent-forecast.ts", 9],
  ["amplify/data/_backend/prediction.ts", 9],
  ["amplify/data/_backend/rivals.ts", 15],
  ["amplify/data/_backend/team-highlights.ts", 11],
]);

function listRepoEntries(rootPath: string) {
  return readdirSync(rootPath, { withFileTypes: true }).map((entry) => ({
    entry,
    entryPath: join(rootPath, entry.name),
  }));
}

function listSourceFiles(rootPath: string): string[] {
  const files: string[] = [];

  for (const { entry, entryPath } of listRepoEntries(rootPath)) {
    if (entry.isDirectory()) {
      if (
        entry.name === ".amplify" ||
        entry.name === ".next" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      files.push(...listSourceFiles(entryPath));
      continue;
    }

    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (sourceExtensions.has(extension)) {
      files.push(entryPath);
    }
  }

  return files;
}

function listFiles(rootPath: string): string[] {
  const files: string[] = [];

  for (const { entry, entryPath } of listRepoEntries(rootPath)) {
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

    files.push(entryPath);
  }

  return files;
}

function listProductionSourceFiles(): string[] {
  return productionSourceRoots.flatMap((rootPath) =>
    listSourceFiles(rootPath).filter(
      (sourceFile) => !testFilePattern.test(sourceFile),
    ),
  );
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

test("lambda data access uses the Amplify runtime client", () => {
  const clientSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "data-client.ts"),
    "utf8",
  );

  assert.match(clientSource, /getAmplifyDataClientConfig/);
  assert.match(clientSource, /generateClient<Schema>\(\)/);
});

test("backend.ts does not manually wire GraphQL endpoint environment variables", () => {
  const backendSource = readFileSync(
    join(repoRoot, "amplify", "backend.ts"),
    "utf8",
  );

  assert.doesNotMatch(backendSource, /AMPLIFY_DATA_GRAPHQL_ENDPOINT/);
  assert.doesNotMatch(backendSource, /_GRAPHQL_ENDPOINT/);
});

test("match-store runtime wiring imports shared infra resources instead of app-local provisioning", () => {
  const integrationSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "match-store-integration.ts"),
    "utf8",
  );

  assert.match(integrationSource, /SharedInfraBindings/);
  assert.match(integrationSource, /Bucket\.fromBucketName/);
  assert.match(integrationSource, /Table\.fromTableName/);
  assert.doesNotMatch(integrationSource, /new Bucket\(/);
  assert.doesNotMatch(integrationSource, /new Table\(/);
  assert.doesNotMatch(integrationSource, /MATCH_DATA_PLANE_SOURCE/);
  assert.doesNotMatch(integrationSource, /sync:match-data-plane/);
  assert.doesNotMatch(integrationSource, /\.env\.match-data-plane/);
  assert.doesNotMatch(integrationSource, /secretsmanager:/);
});

test("lineup helper workspace receives snapshot-table wiring", () => {
  const integrationSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "match-store-integration.ts"),
    "utf8",
  );

  assert.match(integrationSource, /getLineupHelperWorkspace: FunctionResource/);
  assert.match(
    integrationSource,
    /const playerSnapshotReadFunctions = \[[\s\S]*backend\.getLineupHelperWorkspace[\s\S]*\];/,
  );
});

test("user-facing backend snapshot reads stay behind the access boundary", () => {
  const accessSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "player-snapshot-access.ts"),
    "utf8",
  );
  const workspaceSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "workspace.ts"),
    "utf8",
  );
  const lineupHelperSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "lineup-helper.ts"),
    "utf8",
  );

  assert.match(accessSource, /from\s+["']\.\/canonical-player-snapshots["']/);
  assert.doesNotMatch(
    workspaceSource,
    /from\s+["']\.\/canonical-player-snapshots["']/,
  );
  assert.doesNotMatch(
    lineupHelperSource,
    /from\s+["']\.\/canonical-player-snapshots["']/,
  );
});

test("app no longer relies on the generic GraphQL JSON helper", () => {
  assert.equal(existsSync(join(repoRoot, "app", "graphql-json.ts")), false);
});

test("production runtime code only reaches amplify_outputs.json through the approved runtime loader", () => {
  const approvedRuntimeLoader = join(
    repoRoot,
    "app",
    "amplify-outputs-runtime.js",
  );
  const directOutputsImportPattern =
    /from\s+["'][^"']*amplify_outputs\.json["']|import\(\s*["'][^"']*amplify_outputs\.json["']/;

  for (const sourceFile of listProductionSourceFiles()) {
    if (sourceFile === approvedRuntimeLoader) {
      continue;
    }

    const source = readFileSync(sourceFile, "utf8");
    assert.doesNotMatch(
      source,
      directOutputsImportPattern,
      relative(repoRoot, sourceFile),
    );
  }

  const runtimeLoaderSource = readFileSync(approvedRuntimeLoader, "utf8");
  const approvedLoaderSource = readFileSync(
    join(repoRoot, "app", "amplify-outputs.ts"),
    "utf8",
  );
  const serverSource = readFileSync(
    join(repoRoot, "app", "server", "amplify-server.ts"),
    "utf8",
  );

  assert.match(runtimeLoaderSource, directOutputsImportPattern);
  assert.match(
    approvedLoaderSource,
    /from\s+["']@\/app\/amplify-outputs-runtime\.js["']/,
  );
  assert.doesNotMatch(approvedLoaderSource, directOutputsImportPattern);
  assert.match(serverSource, /loadAmplifyOutputs/);
  assert.doesNotMatch(serverSource, /readFileSync/);
  assert.doesNotMatch(serverSource, /return \{\}/);
});

test("server BFF dispatch avoids generated client meta-types", () => {
  const bffSource = readFileSync(
    join(repoRoot, "app", "server", "amplify-bff.ts"),
    "utf8",
  );

  assert.doesNotMatch(
    bffSource,
    /Awaited<ReturnType<typeof getServerDataClient>>/,
  );
  assert.doesNotMatch(bffSource, /Parameters<ServerDataClient/);
  assert.doesNotMatch(bffSource, /DeepReadOnlyObject/);
});

test("production source avoids wrapper-derived meta-types", () => {
  const bannedPatterns = [
    /Awaited<ReturnType<typeof /,
    /Parameters<typeof /,
    /Parameters<[^;\n]*\.(?:queries|mutations|models)\b/,
    /Parameters<[^;\n]*\["(?:queries|mutations|models)"\]/,
  ];

  for (const sourceFile of listProductionSourceFiles()) {
    const source = readFileSync(sourceFile, "utf8");
    for (const pattern of bannedPatterns) {
      assert.doesNotMatch(source, pattern, relative(repoRoot, sourceFile));
    }
  }
});

test("large dependency bags stay on a reviewed allowlist", () => {
  const dependencyBagPattern = /:\s*typeof\s+[A-Za-z0-9_$.]+/g;

  for (const sourceFile of listProductionSourceFiles()) {
    const source = readFileSync(sourceFile, "utf8");
    const relativePath = relative(repoRoot, sourceFile).replaceAll("\\", "/");
    const dependencyCount = countMatches(source, dependencyBagPattern);
    if (dependencyCount <= 3) {
      continue;
    }

    const allowedCount = approvedLargeDependencyBags.get(relativePath);
    assert.notEqual(
      allowedCount,
      undefined,
      `${relativePath} introduces an unreviewed large : typeof dependency bag (${dependencyCount}).`,
    );
    assert.ok(
      dependencyCount <= allowedCount,
      `${relativePath} grew its reviewed : typeof dependency bag from ${allowedCount} to ${dependencyCount}.`,
    );
  }
});

test("deploy verification uses a cold app typecheck", () => {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };

  assert.match(
    packageJson.scripts?.["typecheck:app"] ?? "",
    /--incremental false/,
  );
});

test("app data access exposes explicit read endpoints and no generic model proxy", () => {
  assert.equal(
    existsSync(
      join(repoRoot, "app", "api", "app", "models", "[name]", "route.ts"),
    ),
    false,
  );
  assert.equal(
    existsSync(
      join(repoRoot, "app", "api", "app", "reads", "[name]", "route.ts"),
    ),
    true,
  );
});

test("auth controls pin the lite tier and relax the password policy", () => {
  const authControlsSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "auth-controls.ts"),
    "utf8",
  );

  assert.match(authControlsSource, /userPool\.userPoolTier = "LITE"/);
  assert.match(authControlsSource, /minimumLength: 6/);
  assert.match(authControlsSource, /requireLowercase: false/);
  assert.match(authControlsSource, /requireNumbers: false/);
  assert.match(authControlsSource, /requireSymbols: false/);
  assert.match(authControlsSource, /requireUppercase: false/);
});

test("public app origin and hosted builds rely on shared synth config without sync bridges", () => {
  const authSource = readFileSync(
    join(repoRoot, "amplify", "auth", "resource.ts"),
    "utf8",
  );
  const billingIntegrationSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "billing-integration.ts"),
    "utf8",
  );
  const nextWithEnvSource = readFileSync(
    join(repoRoot, "scripts", "next-with-env.mjs"),
    "utf8",
  );
  const amplifyYamlSource = readFileSync(join(repoRoot, "amplify.yml"), "utf8");

  assert.match(authSource, /_shared\/synth-env\.js/);
  assert.match(billingIntegrationSource, /_shared\/synth-env\.js/);
  assert.match(nextWithEnvSource, /deriveAmplifyAppOrigin/);
  assert.doesNotMatch(amplifyYamlSource, /MATCH_DATA_PLANE_SOURCE/);
  assert.doesNotMatch(amplifyYamlSource, /sync:match-data-plane/);
  assert.doesNotMatch(amplifyYamlSource, /\.env\.match-data-plane/);
  assert.match(amplifyYamlSource, /npm run verify:deploy/);
  assert.match(amplifyYamlSource, /npx ampx pipeline-deploy/);
  assert.match(amplifyYamlSource, /npm run hosted:prepare-env/);
  assert.match(amplifyYamlSource, /npm run build/);
  assert.ok(
    amplifyYamlSource.indexOf("npm run verify:deploy") <
      amplifyYamlSource.indexOf("npx ampx pipeline-deploy"),
  );
  assert.ok(
    amplifyYamlSource.indexOf("npm run hosted:prepare-env") <
      amplifyYamlSource.indexOf("npm run build"),
  );
});

test("backend no longer carries a handwritten $amplify/env shim", () => {
  assert.equal(existsSync(join(repoRoot, "amplify", "env.d.ts")), false);
});

test("synth-time backend files do not import root lib helpers", () => {
  const amplifyRoot = join(repoRoot, "amplify");
  const rootLibImportPatterns = [
    /from\s+["'`](?:\.\.\/)+lib\//,
    /import\s*\(\s*["'`](?:\.\.\/)+lib\//,
    /require\s*\(\s*["'`](?:\.\.\/)+lib\//,
  ];

  const synthTimeFiles = listSourceFiles(amplifyRoot).filter((sourceFile) => {
    const relativePath = relative(amplifyRoot, sourceFile).replaceAll(
      "\\",
      "/",
    );

    return (
      relativePath === "backend.ts" ||
      relativePath.startsWith("_shared/") ||
      relativePath.startsWith("_backend/") ||
      /(?:^|\/)resource\.ts$/.test(relativePath)
    );
  });

  for (const sourceFile of synthTimeFiles) {
    const source = readFileSync(sourceFile, "utf8");
    for (const pattern of rootLibImportPatterns) {
      assert.doesNotMatch(source, pattern, sourceFile);
    }
  }
});

test("synth-time backend files only read process.env through the shared synth env helper", () => {
  const amplifyRoot = join(repoRoot, "amplify");
  const synthTimeFiles = listSourceFiles(amplifyRoot).filter((sourceFile) => {
    const relativePath = relative(amplifyRoot, sourceFile).replaceAll(
      "\\",
      "/",
    );

    return (
      relativePath === "backend.ts" ||
      relativePath.startsWith("_backend/") ||
      /(?:^|\/)resource\.ts$/.test(relativePath)
    );
  });

  for (const sourceFile of synthTimeFiles) {
    const relativePath = relative(amplifyRoot, sourceFile).replaceAll(
      "\\",
      "/",
    );
    if (relativePath === "_shared/synth-env.ts") {
      continue;
    }

    const source = readFileSync(sourceFile, "utf8");
    assert.doesNotMatch(source, /process\.env/, sourceFile);
  }
});

test("bb-amplify no longer carries the in-repo ML infra stacks", () => {
  assert.equal(existsSync(join(repoRoot, "infra", "match-data-plane")), false);
  assert.equal(existsSync(join(repoRoot, "infra", "matchup-predictor")), false);
});

test("backend-reachable source does not use the Next app alias", () => {
  const backendReachableRoots = [
    join(repoRoot, "amplify"),
    join(repoRoot, "lib", "coach-parrot"),
    join(repoRoot, "lib", "buzzerbeater"),
  ];
  const aliasImportPatterns = [
    /from\s+["'`]@\//,
    /import\s*\(\s*["'`]@\//,
    /require\s*\(\s*["'`]@\//,
  ];

  for (const runtimeRoot of backendReachableRoots) {
    for (const sourceFile of listSourceFiles(runtimeRoot)) {
      const source = readFileSync(sourceFile, "utf8");
      for (const pattern of aliasImportPatterns) {
        assert.doesNotMatch(source, pattern);
      }
    }
  }
});

test("runtime code does not read process.env directly", () => {
  const runtimeRoots = [
    join(repoRoot, "app"),
    join(repoRoot, "lib"),
    join(repoRoot, "amplify", "data"),
  ];

  for (const runtimeRoot of runtimeRoots) {
    for (const sourceFile of listSourceFiles(runtimeRoot)) {
      const source = readFileSync(sourceFile, "utf8");
      assert.doesNotMatch(source, /process\.env/);
    }
  }
});

test("runtime source does not use Amplify model.list scans", () => {
  const runtimeRoots = [
    join(repoRoot, "app"),
    join(repoRoot, "amplify", "data"),
  ];

  for (const runtimeRoot of runtimeRoots) {
    for (const sourceFile of listSourceFiles(runtimeRoot)) {
      const source = readFileSync(sourceFile, "utf8");
      assert.doesNotMatch(source, /\.list\s*\(/);
    }
  }
});

test("deployable source never colocates or imports test modules", () => {
  const deployableRoots = [
    join(repoRoot, "app"),
    join(repoRoot, "public"),
    join(repoRoot, "amplify"),
    join(repoRoot, "lib"),
  ];

  const misplacedTestFiles = deployableRoots.flatMap((rootPath) =>
    listFiles(rootPath).filter((filePath) => testFilePattern.test(filePath)),
  );
  assert.deepStrictEqual(misplacedTestFiles, []);

  const importPatterns = [
    /from\s+["'`][^"'`]*\/tests\//,
    /from\s+["'`][^"'`]*\.(?:test|spec)\.[^"'`]*/,
    /import\s*\(\s*["'`][^"'`]*\/tests\//,
    /import\s*\(\s*["'`][^"'`]*\.(?:test|spec)\.[^"'`]*/,
    /require\s*\(\s*["'`][^"'`]*\/tests\//,
    /require\s*\(\s*["'`][^"'`]*\.(?:test|spec)\.[^"'`]*/,
  ];

  for (const rootPath of deployableRoots.filter(
    (rootPath) => !rootPath.endsWith("/public"),
  )) {
    for (const sourceFile of listSourceFiles(rootPath)) {
      const source = readFileSync(sourceFile, "utf8");
      for (const pattern of importPatterns) {
        assert.doesNotMatch(source, pattern);
      }
    }
  }
});

test("amplify server adapter no longer mutates process.env", () => {
  const amplifyServerSource = readFileSync(
    join(repoRoot, "app", "server", "amplify-server.ts"),
    "utf8",
  );

  assert.doesNotMatch(amplifyServerSource, /process\.env/);
});

test("typed backend operation helpers do not return generic records", () => {
  const workspaceSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "workspace.ts"),
    "utf8",
  );
  const lineupHelperSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "lineup-helper.ts"),
    "utf8",
  );
  const teamHighlightsSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "team-highlights.ts"),
    "utf8",
  );
  const matchStoreSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "match-store.ts"),
    "utf8",
  );

  assert.doesNotMatch(
    workspaceSource,
    /export async function (generatePlayerCard|revokePlayerCard|lookupSharedPlayerCardByToken|getPlayerTrend|getLineupPlan|saveLineupScenario|getSalaryProjection)[\s\S]*Promise<Record<string, unknown>/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /export async function getScoutWorkspaceForTeam/,
  );
  assert.doesNotMatch(
    lineupHelperSource,
    /export async function (getLineupHelperWorkspace|evaluateLineupHelper)[\s\S]*Promise<Record<string, unknown>/,
  );
  assert.doesNotMatch(
    teamHighlightsSource,
    /export async function getMyTeamHighlights[\s\S]*Promise<Record<string, unknown>/,
  );
  assert.match(
    matchStoreSource,
    /export async function getMatchBoxscoreDetails[\s\S]*Promise<MatchBoxscoreDetailsResult>/,
  );
});

test("typed handlers no longer cast GraphQL return payloads", () => {
  const handlerPaths = [
    join(
      repoRoot,
      "amplify",
      "data",
      "get-lineup-helper-workspace",
      "handler.ts",
    ),
    join(repoRoot, "amplify", "data", "evaluate-lineup-helper", "handler.ts"),
    join(repoRoot, "amplify", "data", "get-salary-projection", "handler.ts"),
  ];

  for (const handlerPath of handlerPaths) {
    const handlerSource = readFileSync(handlerPath, "utf8");
    assert.doesNotMatch(
      handlerSource,
      /as Promise<NonNullable<Schema\["[^"]+"\]\["returnType"\]>>/,
    );
  }
});

test("team highlights submitter receives the shared credential secret", () => {
  const resourceSource = readFileSync(
    join(repoRoot, "amplify", "data", "resource.ts"),
    "utf8",
  );

  assert.match(
    resourceSource,
    /export const submitMyTeamHighlightsScan = defineFunction\(\{[\s\S]*environment: secureFunctionEnvironment,[\s\S]*\}\);/,
  );
});

test("scheduled maintenance rules live only in the retained data lambda stack", () => {
  const retentionSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "operational-retention.ts"),
    "utf8",
  );

  assert.equal(
    existsSync(join(repoRoot, "amplify", "_backend", "refresh-jobs.ts")),
    false,
  );
  assert.match(
    retentionSource,
    /Stack\.of\(backend\.pruneOperationalData\.resources\.lambda\)/,
  );
});
