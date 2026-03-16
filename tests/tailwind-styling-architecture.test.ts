import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const appDir = join(repoRoot, "app");

const legacyClassPatterns = [
  "dashboard-card",
  "summary-card",
  "subpanel",
  "workspace-route-link",
  "prediction-input",
  "prediction-select",
  "secondary-button",
  "status-badge",
  "inline-alert",
];

test("layout imports globals.css and not the legacy app.css stylesheet", () => {
  const layoutSource = readFileSync(join(appDir, "layout.tsx"), "utf8");

  assert.match(layoutSource, /import "\.\/globals\.css";/);
  assert.doesNotMatch(layoutSource, /import "\.\/app\.css";/);
  assert.doesNotMatch(layoutSource, /@aws-amplify\/ui-react\/styles\.css/);
});

test("app surface no longer imports Amplify UI", () => {
  const appSources = readTsxFiles(appDir).map((file) => readFileSync(file, "utf8"));

  for (const source of appSources) {
    assert.doesNotMatch(source, /@aws-amplify\/ui-react/);
  }
});

test("migrated app surface no longer relies on legacy semantic CSS classes", () => {
  const appSources = readTsxFiles(appDir).map((file) => readFileSync(file, "utf8"));

  for (const source of appSources) {
    for (const pattern of legacyClassPatterns) {
      assert.doesNotMatch(source, new RegExp(`className[^\\n]{0,200}\\b${pattern}\\b`));
    }
  }
});

function readTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return readTsxFiles(path);
    }

    return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
  });
}
