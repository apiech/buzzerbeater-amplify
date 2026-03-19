import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

function readRepoFile(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

test("layout resolves the authenticated account theme on the server", () => {
  const layoutSource = readRepoFile("app", "layout.tsx");

  assert.match(layoutSource, /getServerCurrentUser/);
  assert.match(layoutSource, /resolveServerThemeId\(currentUser\?\.userId\)/);
  assert.match(layoutSource, /<html lang="en" data-theme=\{themeId\}>/);
  assert.doesNotMatch(layoutSource, /getThemeInitScript/);
  assert.doesNotMatch(layoutSource, /suppressHydrationWarning/);
});

test("account theme persistence is modeled as an owner-scoped user preference", () => {
  const dataResourceSource = readRepoFile("amplify", "data", "resource.ts");
  const authResourceSource = readRepoFile("amplify", "auth", "resource.ts");

  assert.match(
    dataResourceSource,
    /ThemeId:\s*a\.enum\(\["clubhouse", "arena", "nightfall"\]\)/,
  );
  assert.match(
    dataResourceSource,
    /UserPreference:\s*a[\s\S]*?identifier\(\["userId"\]\)/,
  );
  assert.match(
    dataResourceSource,
    /UserPreference:[\s\S]*?allow\.ownerDefinedIn\("userId"\)/,
  );
  assert.match(
    dataResourceSource,
    /UserPreference:[\s\S]*?userId:\s*a[\s\S]*?allow\.ownerDefinedIn\("userId"\)\.to\(\["read", "delete"\]\)/,
  );
  assert.match(authResourceSource, /\/api\/auth\/sign-in-callback/);
  assert.match(authResourceSource, /\/api\/auth\/sign-out-callback/);
});

test("workspace requests are routed through server-authenticated Next entry points", () => {
  const proxySource = readRepoFile("proxy.ts");
  const homePageSource = readRepoFile("app", "page.tsx");
  const workspacePageSource = readRepoFile(
    "app",
    "workspace",
    "[section]",
    "page.tsx",
  );
  const loginPageSource = readRepoFile("app", "login", "page.tsx");
  const storePageSource = readRepoFile("app", "store", "page.tsx");
  const authRouteSource = readRepoFile(
    "app",
    "api",
    "auth",
    "[slug]",
    "route.ts",
  );
  const dashboardSource = readRepoFile("app", "dashboard-app.tsx");

  assert.match(
    proxySource,
    /export async function proxy\(request: NextRequest\)/,
  );
  assert.match(proxySource, /matcher:\s*\["\/workspace\/:path\*"\]/);
  assert.match(proxySource, /new URL\("\/login", request\.url\)/);
  assert.match(homePageSource, /getServerCurrentUser/);
  assert.match(
    homePageSource,
    /const primaryHref = currentUser \? "\/workspace\/home" : "\/login";/,
  );
  assert.match(homePageSource, /href="\/store"/);
  assert.match(workspacePageSource, /redirect\("\/login"\)/);
  assert.match(
    workspacePageSource,
    /viewerEmail=\{resolveViewerEmail\(currentUser\)\}/,
  );
  assert.match(loginPageSource, /href="\/api\/auth\/sign-in"/);
  assert.match(loginPageSource, /href="\/api\/auth\/sign-up"/);
  assert.match(loginPageSource, /href="\/store"/);
  assert.match(storePageSource, /<Storefront/);
  assert.match(authRouteSource, /createAuthRouteHandlers/);
  assert.match(
    authRouteSource,
    /redirectOnSignInComplete:\s*"\/workspace\/home"/,
  );
  assert.match(authRouteSource, /redirectOnSignOutComplete:\s*"\/login"/);
  assert.match(dashboardSource, /href="\/api\/auth\/sign-out"/);
  assert.doesNotMatch(dashboardSource, /<LegacyLocalAuthShell/);
});

test("client theme updates and data access go through internal app routes", () => {
  const themeSelectSource = readRepoFile(
    "app",
    "ui",
    "theme",
    "theme-select.tsx",
  );
  const themeRouteSource = readRepoFile(
    "app",
    "api",
    "app",
    "theme",
    "route.ts",
  );
  const clientSource = readRepoFile("app", "amplify-client.ts");

  assert.match(themeSelectSource, /fetch\("\/api\/app\/theme"/);
  assert.doesNotMatch(themeSelectSource, /localStorage/);
  assert.match(themeRouteSource, /requireServerCurrentUser/);
  assert.match(themeRouteSource, /upsertServerThemePreference/);
  assert.match(clientSource, /\/api\/app\/reads\//);
  assert.match(clientSource, /\/api\/app\/queries\//);
  assert.match(clientSource, /\/api\/app\/mutations\//);
  assert.doesNotMatch(clientSource, /\/api\/app\/models\//);
  assert.doesNotMatch(clientSource, /generateClient</);
  assert.doesNotMatch(clientSource, /Amplify\.configure/);
});
