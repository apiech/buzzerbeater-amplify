import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const testFilePattern = /\.(?:test|spec)\.[^.]+$/;
const productionSourceRoots = [
  join(repoRoot, "app"),
  join(repoRoot, "amplify"),
  join(repoRoot, "scripts"),
] as const;
const dependencyBagReviewSourceRoots = [
  join(repoRoot, "amplify", "data", "_backend"),
  join(repoRoot, "app", "server"),
  join(repoRoot, "scripts"),
] as const;
const LARGE_DEPENDENCY_BAG_REVIEW_THRESHOLD = 6;
const approvedLargeDependencyBags = new Map<string, number>([
  ["amplify/data/_backend/game-day-recap.ts#ProcessDependencies", 10],
  ["amplify/data/_backend/game-day-recap.ts#SubmitDependencies", 13],
  ["amplify/data/_backend/rivals.ts#ProcessDependencies", 7],
]);

type DependencyBagSummary = {
  dependencyCount: number;
  identifier: string;
  name: string;
  relativePath: string;
};

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

function listDependencyBagReviewSourceFiles(): string[] {
  return dependencyBagReviewSourceRoots.flatMap((rootPath) =>
    listSourceFiles(rootPath).filter(
      (sourceFile) => !testFilePattern.test(sourceFile),
    ),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveScriptKindForFileName(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (fileName.endsWith(".mjs") || fileName.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isDependencyBagName(name: string): boolean {
  return /(?:Dependencies|Deps)$/.test(name);
}

function countTypeQueryMembers(
  members: ts.NodeArray<ts.TypeElement>,
): number {
  let count = 0;

  for (const member of members) {
    if (!ts.isPropertySignature(member)) {
      continue;
    }
    if (member.type && ts.isTypeQueryNode(member.type)) {
      count += 1;
    }
  }

  return count;
}

function collectDependencyBagsFromSource(
  source: string,
  options?: {
    fileName?: string;
    relativePath?: string;
  },
): DependencyBagSummary[] {
  const fileName = options?.fileName ?? "inline.ts";
  const relativePath = options?.relativePath ?? fileName;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    resolveScriptKindForFileName(fileName),
  );
  const summaries: DependencyBagSummary[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      const name = statement.name.text;
      if (!isDependencyBagName(name) || !ts.isTypeLiteralNode(statement.type)) {
        continue;
      }
      const dependencyCount = countTypeQueryMembers(statement.type.members);
      if (dependencyCount === 0) {
        continue;
      }
      summaries.push({
        dependencyCount,
        identifier: `${relativePath}#${name}`,
        name,
        relativePath,
      });
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      const name = statement.name.text;
      if (!isDependencyBagName(name)) {
        continue;
      }
      const dependencyCount = countTypeQueryMembers(statement.members);
      if (dependencyCount === 0) {
        continue;
      }
      summaries.push({
        dependencyCount,
        identifier: `${relativePath}#${name}`,
        name,
        relativePath,
      });
    }
  }

  return summaries;
}

function collectDependencyBagsForSourceFile(
  sourceFilePath: string,
): DependencyBagSummary[] {
  return collectDependencyBagsFromSource(readFileSync(sourceFilePath, "utf8"), {
    fileName: sourceFilePath,
    relativePath: relative(repoRoot, sourceFilePath).replaceAll("\\", "/"),
  });
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

test("workspace cache schema keeps arena optional for legacy cache compatibility", () => {
  const resourceSource = readFileSync(
    join(repoRoot, "amplify", "data", "resource.ts"),
    "utf8",
  );
  const workspaceCacheSection =
    resourceSource.match(
      /WorkspaceCachePayload: a\.customType\(\{[\s\S]*?\n    \}\),/,
    )?.[0] ?? "";

  assert.match(workspaceCacheSection, /arena: a\.ref\("ArenaWorkspace"\),/);
  assert.doesNotMatch(
    workspaceCacheSection,
    /arena: a\.ref\("ArenaWorkspace"\)\.required\(\)/,
  );
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
    /const workspaceSnapshotWriteFunctions = \[[\s\S]*backend\.getLineupHelperWorkspace[\s\S]*\];/,
  );
});

test("owner roster repair receives snapshot-table write wiring", () => {
  const backendSource = readFileSync(
    join(repoRoot, "amplify", "backend.ts"),
    "utf8",
  );
  const integrationSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "match-store-integration.ts"),
    "utf8",
  );

  assert.match(backendSource, /repairOwnerRosterData/);
  assert.match(integrationSource, /repairOwnerRosterData: FunctionResource/);
  assert.match(
    integrationSource,
    /const workspaceSnapshotWriteFunctions = \[[\s\S]*backend\.repairOwnerRosterData[\s\S]*\];/,
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

test("structured Next and repository loggers use console logging instead of raw process streams", () => {
  const bffSource = readFileSync(
    join(repoRoot, "app", "server", "amplify-bff.ts"),
    "utf8",
  );
  const operationRouteSource = readFileSync(
    join(repoRoot, "app", "api", "app", "operation-route.ts"),
    "utf8",
  );
  const repositorySource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "repository.ts"),
    "utf8",
  );

  for (const source of [bffSource, operationRouteSource, repositorySource]) {
    assert.match(source, /console\.log/);
    assert.match(source, /console\.error/);
    assert.doesNotMatch(source, /process\.(stdout|stderr)\.write/);
  }
});

test("repository owned-data writes validate payload contracts instead of sanitizing nested blobs", () => {
  const repositorySource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "repository.ts"),
    "utf8",
  );

  assert.match(repositorySource, /assertModelInputShape/);
  assert.doesNotMatch(repositorySource, /prepareModelInputWithDiagnostics/);
  assert.doesNotMatch(repositorySource, /sanitizeModelInput/);
  assert.doesNotMatch(repositorySource, /sanitizeBbConnectionInput/);
  assert.doesNotMatch(repositorySource, /sanitizeTrackedTeamInput/);
  assert.doesNotMatch(repositorySource, /sanitizeTrackedPlayerInput/);
  assert.doesNotMatch(repositorySource, /sanitizeNestedAttributes/);
  assert.doesNotMatch(repositorySource, /stripAttributesDeep/);
});

test("workspace connection builders validate nested owned payloads before carrying them forward", () => {
  const workspaceConnectionSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "workspace-connection.ts"),
    "utf8",
  );

  assert.match(workspaceConnectionSource, /assertStoredTeamInfo/);
  assert.match(workspaceConnectionSource, /assertWorkspaceCachePayload/);
});

test("workspace home connection paths project raw connection records into explicit DTOs", () => {
  const workspaceSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "workspace.ts"),
    "utf8",
  );
  const readBffSource = readFileSync(
    join(repoRoot, "app", "server", "read-bff.ts"),
    "utf8",
  );
  const buildHomeWorkspaceSection =
    workspaceSource.match(
      /function buildHomeWorkspace[\s\S]*?function buildHomeNextMatch/,
    )?.[0] ?? "";
  const rehydrateHomeWorkspaceSection =
    workspaceSource.match(
      /function rehydrateHomeWorkspace[\s\S]*?function projectHomeWorkspaceConnection/,
    )?.[0] ?? "";

  assert.match(workspaceSource, /from\s+["']\.\/connection-projection["']/);
  assert.match(
    buildHomeWorkspaceSection,
    /connection:\s*projectHomeWorkspaceConnection\(/,
  );
  assert.doesNotMatch(buildHomeWorkspaceSection, /^\s*connection,\s*$/m);
  assert.match(
    rehydrateHomeWorkspaceSection,
    /connection:\s*projectHomeWorkspaceConnection\(/,
  );
  assert.doesNotMatch(rehydrateHomeWorkspaceSection, /^\s*connection,\s*$/m);
  assert.match(readBffSource, /projectCurrentConnectionResult/);
});

test("tracked-player storage contracts keep potential and use explicit stored-roster projection", () => {
  const workspaceSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "workspace.ts"),
    "utf8",
  );
  const resourceSource = readFileSync(
    join(repoRoot, "amplify", "data", "resource.ts"),
    "utf8",
  );
  const storedRosterSkillsSection =
    resourceSource.match(
      /StoredOwnedRosterPlayerSkills: a\.customType\(\{[\s\S]*?\n    \}\),/,
    )?.[0] ?? "";
  const trackedPlayerProjectionSection =
    workspaceSource.match(
      /function projectStoredOwnedRosterPlayer[\s\S]*?function selectNextMatch/,
    )?.[0] ?? "";

  assert.match(
    storedRosterSkillsSection,
    /potential: a\.integer\(\)\.required\(\),/,
  );
  assert.match(workspaceSource, /function projectStoredOwnedRosterPlayer/);
  assert.match(
    trackedPlayerProjectionSection,
    /potential: player\.skills\.potential,/,
  );
  assert.doesNotMatch(
    trackedPlayerProjectionSection,
    /skills:\s*\{\s*\.\.\.player\.skills\s*\}/s,
  );
});

test("dashboard connection and cache parsers reuse the shared strict owned-data contracts", () => {
  const queryClientSource = readFileSync(
    join(repoRoot, "app", "dashboard", "workspace-query-client.ts"),
    "utf8",
  );
  const connectionContractSection =
    queryClientSource.match(
      /const nullableStringSchema[\s\S]*?const lineupHelperDefensiveSwitchSchema/,
    )?.[0] ?? "";

  assert.match(
    queryClientSource,
    /from\s+["']@\/lib\/owned-data\/contracts["']/,
  );
  assert.doesNotMatch(connectionContractSection, /const namedReferenceSchema/);
  assert.doesNotMatch(
    connectionContractSection,
    /const connectionResultSchema/,
  );
  assert.doesNotMatch(connectionContractSection, /const homeWorkspaceSchema/);
  assert.doesNotMatch(
    connectionContractSection,
    /const workspaceCachePayloadSchema/,
  );
  assert.doesNotMatch(connectionContractSection, /\.passthrough\(/);
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

test("production source does not hand-write Amplify contract object types that already exist in Schema", () => {
  const contractNames = [
    "BillingPaymentsPage",
    "BillingSummary",
    "ConnectBbAccountInput",
    "GameDayRecapCoveragePayload",
    "GameDayRecapResultPayload",
    "LineupHelperAssignment",
    "LineupHelperContext",
    "LineupHelperRankingEntry",
    "LineupHelperRosterPlayer",
    "LineupHelperSkillRatings",
    "PredictionForecastContext",
    "PredictionInput",
    "PredictionSubmissionRequest",
    "TeamInfoSummary",
  ];
  const resourceSource = join(repoRoot, "amplify", "data", "resource.ts");

  for (const sourceFile of listProductionSourceFiles()) {
    if (sourceFile === resourceSource) {
      continue;
    }

    const source = readFileSync(sourceFile, "utf8");
    const relativePath = relative(repoRoot, sourceFile);

    for (const contractName of contractNames) {
      const pattern = new RegExp(
        String.raw`(?:^|\n)\s*(?:export\s+)?(?:type|interface)\s+${escapeRegex(contractName)}\s*(?:=\s*\{|\{)`,
      );
      assert.doesNotMatch(
        source,
        pattern,
        `${relativePath} redefines ${contractName}.`,
      );
    }
  }
});

test("production source avoids casting cached data into schema-backed workspace contract types", () => {
  const contractNames = [
    "ArenaWorkspaceResult",
    "HomeWorkspaceResult",
    "LeagueIntelWorkspaceResult",
    "PlayerLabWorkspaceResult",
    "ScoutWorkspaceResult",
    "TeamHubWorkspaceResult",
  ];

  for (const sourceFile of listProductionSourceFiles()) {
    const source = readFileSync(sourceFile, "utf8");
    const relativePath = relative(repoRoot, sourceFile);

    for (const contractName of contractNames) {
      const pattern = new RegExp(
        String.raw`as unknown as\s+${escapeRegex(contractName)}\b`,
      );
      assert.doesNotMatch(
        source,
        pattern,
        `${relativePath} casts into ${contractName}.`,
      );
    }
  }
});

test("dependency bag parser counts only typeof members on explicit bag declarations", () => {
  const summaries = collectDependencyBagsFromSource(
    [
      "type FooDependencies = {",
      "  fetchUser: typeof fetchUser,",
      "  fetchTeam: typeof fetchTeam,",
      "  fetchLeague: typeof fetchLeague,",
      "};",
    ].join("\n"),
    { relativePath: "inline.ts" },
  );

  assert.deepEqual(summaries, [
    {
      dependencyCount: 3,
      identifier: "inline.ts#FooDependencies",
      name: "FooDependencies",
      relativePath: "inline.ts",
    },
  ]);
});

test("dependency bag parser ignores runtime typeof guards", () => {
  const summaries = collectDependencyBagsFromSource(
    [
      "const prefix =",
      '  typeof value === "string"',
      '    ? "label"',
      '    : typeof fallback === "number"',
      '      ? "count"',
      '      : "other";',
    ].join("\n"),
    { relativePath: "inline.ts" },
  );

  assert.deepEqual(summaries, []);
});

test("dependency bag parser ignores typeof guards inside non-bag type aliases", () => {
  const summaries = collectDependencyBagsFromSource(
    [
      "type SomethingElse = {",
      "  fetchUser: typeof fetchUser,",
      "};",
      "",
      "const prefix = typeof value === \"string\" ? value : \"\";",
    ].join("\n"),
    { relativePath: "inline.ts" },
  );

  assert.deepEqual(summaries, []);
});

test("dependency bag review stays scoped to backend and server orchestration roots", () => {
  const reviewedFiles = new Set(
    listDependencyBagReviewSourceFiles().map((sourceFile) =>
      relative(repoRoot, sourceFile).replaceAll("\\", "/"),
    ),
  );

  assert.equal(reviewedFiles.has("app/recap-panel.tsx"), false);
  assert.equal(
    reviewedFiles.has("amplify/data/_backend/game-day-recap.ts"),
    true,
  );
});

test("large orchestration dependency bags stay on a reviewed allowlist", () => {
  const largeDependencyBags = listDependencyBagReviewSourceFiles()
    .flatMap((sourceFile) => collectDependencyBagsForSourceFile(sourceFile))
    .filter(
      (dependencyBag) =>
        dependencyBag.dependencyCount > LARGE_DEPENDENCY_BAG_REVIEW_THRESHOLD,
    )
    .sort((left, right) => left.identifier.localeCompare(right.identifier));

  assert.deepEqual(
    largeDependencyBags.map((dependencyBag) => dependencyBag.identifier),
    [...approvedLargeDependencyBags.keys()].sort(),
  );

  for (const dependencyBag of largeDependencyBags) {
    const allowedCount = approvedLargeDependencyBags.get(
      dependencyBag.identifier,
    );
    assert.notEqual(
      allowedCount,
      undefined,
      `${dependencyBag.identifier} introduces an unreviewed large dependency bag (${dependencyBag.dependencyCount}).`,
    );
    assert.ok(
      dependencyBag.dependencyCount <= allowedCount,
      `${dependencyBag.identifier} grew its reviewed dependency bag from ${allowedCount} to ${dependencyBag.dependencyCount}.`,
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
  assert.doesNotMatch(
    packageJson.scripts?.["verify:deploy"] ?? "",
    /typecheck:amplify/,
  );
  assert.match(
    packageJson.scripts?.["typecheck:amplify"] ?? "",
    /typecheck-amplify/,
  );
  assert.match(
    packageJson.scripts?.["verify:deploy:sandbox"] ?? "",
    /typecheck:amplify:sandbox/,
  );
});

test("production source avoids raw Map/Set iterator loops that require downlevelIteration", () => {
  const rawIteratorLoopPattern =
    /for\s*\(\s*const\s+[^)]*\s+of\s+[A-Za-z0-9_$.]+\.(?:entries|keys|values)\(\)\s*\)/g;

  for (const sourceFile of listProductionSourceFiles()) {
    const source = readFileSync(sourceFile, "utf8");
    const relativePath = relative(repoRoot, sourceFile).replaceAll("\\", "/");

    assert.doesNotMatch(
      source,
      rawIteratorLoopPattern,
      `${relativePath} uses a raw iterator loop that can fail under the app TypeScript target. Wrap the iterator in Array.from(...) or use forEach().`,
    );
  }
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

test("auth controls pin the Essentials tier and relax the password policy", () => {
  const authControlsSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "auth-controls.ts"),
    "utf8",
  );

  assert.match(authControlsSource, /userPool\.userPoolTier = "ESSENTIALS"/);
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
