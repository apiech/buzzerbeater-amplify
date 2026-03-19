import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const sourceRoots = ["app", "amplify", "lib", "scripts", "tests"] as const;
const rootFiles = ["next.config.ts", "proxy.ts"] as const;
const sourceExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const bannedTerms = [
  ["sign", "In", "Details"].join(""),
  ["login", "Id"].join(""),
];

test("repo-owned source does not reference deprecated auth sign-in metadata", () => {
  const files = [
    ...sourceRoots.flatMap((segment) =>
      collectSourceFiles(join(repoRoot, segment)),
    ),
    ...rootFiles
      .map((segment) => join(repoRoot, segment))
      .filter((path) => existsSync(path)),
  ];

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    for (const term of bannedTerms) {
      assert.equal(
        source.includes(term),
        false,
        `${filePath} still references deprecated auth field ${term}.`,
      );
    }
  }
});

function collectSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath);
    }

    for (const extension of sourceExtensions) {
      if (entry.name.endsWith(extension)) {
        return [entryPath];
      }
    }

    return [];
  });
}
