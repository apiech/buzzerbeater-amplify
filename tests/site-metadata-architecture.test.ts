import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

function readRepoFile(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

test("public pages define route-aware metadata and workspace pages stay noindex", () => {
  const siteConfigSource = readRepoFile("app", "site-config.ts");
  const layoutSource = readRepoFile("app", "layout.tsx");
  const loginPageSource = readRepoFile("app", "login", "page.tsx");
  const robotsSource = readRepoFile("app", "robots.ts");
  const sitemapSource = readRepoFile("app", "sitemap.ts");
  const storePageSource = readRepoFile("app", "store", "page.tsx");
  const workspaceLayoutSource = readRepoFile("app", "workspace", "layout.tsx");

  assert.match(siteConfigSource, /metadataBase: siteUrl/);
  assert.doesNotMatch(siteConfigSource, /manifest: "\/manifest\.webmanifest"/);
  assert.match(
    layoutSource,
    /<link[\s\S]*?rel="manifest"[\s\S]*?href="\/manifest\.webmanifest"[\s\S]*?crossOrigin="use-credentials"/,
  );
  assert.match(siteConfigSource, /url: "\/opengraph-image"/);
  assert.match(loginPageSource, /noindex: true/);
  assert.match(storePageSource, /path: "\/store"/);
  assert.match(storePageSource, /notFound\(\)/);
  assert.match(
    robotsSource,
    /import\s+\{\s*commercialModeEnabled\s*\}\s+from\s+"@\/config\/commercial-mode"/,
  );
  assert.match(
    sitemapSource,
    /import\s+\{\s*commercialModeEnabled\s*\}\s+from\s+"@\/config\/commercial-mode"/,
  );
  assert.match(workspaceLayoutSource, /index: false/);
  assert.match(workspaceLayoutSource, /follow: false/);
});

test("standard metadata files and branded assets exist", () => {
  assert.ok(existsSync(join(repoRoot, "app", "manifest.ts")));
  assert.ok(existsSync(join(repoRoot, "app", "robots.ts")));
  assert.ok(existsSync(join(repoRoot, "app", "sitemap.ts")));
  assert.ok(existsSync(join(repoRoot, "app", "not-found.tsx")));
  assert.ok(existsSync(join(repoRoot, "app", "opengraph-image.tsx")));
  assert.ok(existsSync(join(repoRoot, "app", "twitter-image.tsx")));
  assert.ok(existsSync(join(repoRoot, "app", "icon.svg")));
  assert.ok(existsSync(join(repoRoot, "app", "apple-icon.png")));
  assert.ok(existsSync(join(repoRoot, "app", "favicon.ico")));
});
