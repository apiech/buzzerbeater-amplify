import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function listSourceFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(rootPath, entry.name);
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

test("match-store runtime wiring no longer uses per-user Secrets Manager", () => {
  const integrationSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "match-store-integration.ts"),
    "utf8",
  );
  const dataPlaneStackSource = readFileSync(
    join(
      repoRoot,
      "infra",
      "match-data-plane",
      "lib",
      "match-data-plane-stack.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(integrationSource, /BB_CONNECTION_SECRET_PREFIX/);
  assert.doesNotMatch(integrationSource, /secretsmanager:/);
  assert.doesNotMatch(dataPlaneStackSource, /secretsmanager:/);
  assert.match(dataPlaneStackSource, /BB_CONNECTION_ENCRYPTION_SECRET/);
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

test("app no longer relies on the generic GraphQL JSON helper", () => {
  assert.equal(existsSync(join(repoRoot, "app", "graphql-json.ts")), false);
});

test("app data access exposes explicit read endpoints and no generic model proxy", () => {
  assert.equal(
    existsSync(join(repoRoot, "app", "api", "app", "models", "[name]", "route.ts")),
    false,
  );
  assert.equal(
    existsSync(join(repoRoot, "app", "api", "app", "reads", "[name]", "route.ts")),
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

test("public app origin flows through the shared helper and CI syncs external match-data-plane config", () => {
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

  assert.match(authSource, /resolvePublicAppOrigin/);
  assert.match(billingIntegrationSource, /resolvePublicAppOrigin/);
  assert.match(nextWithEnvSource, /deriveAmplifyAppOrigin/);
  assert.match(
    amplifyYamlSource,
    /MATCH_DATA_PLANE_SOURCE:-local.*npm run sync:match-data-plane[\s\S]*npx ampx pipeline-deploy/,
  );
  assert.match(
    amplifyYamlSource,
    /MATCH_DATA_PLANE_SOURCE:-local.*npm run sync:match-data-plane[\s\S]*npm run build/,
  );
});

test("backend no longer carries a handwritten $amplify/env shim", () => {
  assert.equal(existsSync(join(repoRoot, "amplify", "env.d.ts")), false);
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
    /export async function (generatePlayerCard|revokePlayerCard|lookupSharedPlayerCardByToken|getPlayerTrend|getLineupPlan|saveLineupScenario|getSalaryProjection|getScoutWorkspaceForTeam)[\s\S]*Promise<Record<string, unknown>/,
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
    join(repoRoot, "amplify", "data", "get-lineup-plan", "handler.ts"),
    join(repoRoot, "amplify", "data", "save-lineup-scenario", "handler.ts"),
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

test("scheduled maintenance rules live in the data lambda stack", () => {
  const refreshJobsSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "refresh-jobs.ts"),
    "utf8",
  );
  const retentionSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "operational-retention.ts"),
    "utf8",
  );

  assert.match(
    refreshJobsSource,
    /Stack\.of\(backend\.refreshBbWorkspaces\.resources\.lambda\)/,
  );
  assert.match(
    retentionSource,
    /Stack\.of\(backend\.pruneOperationalData\.resources\.lambda\)/,
  );
});
