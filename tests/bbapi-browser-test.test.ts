import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("BB API browser diagnostic runs the probe purely from the client", () => {
  const pageSource = readFileSync(
    join(repoRoot, "app", "bbapi-browser-test", "page.tsx"),
    "utf8",
  );
  const clientSource = readFileSync(
    join(
      repoRoot,
      "app",
      "bbapi-browser-test",
      "bbapi-browser-test-client.tsx",
    ),
    "utf8",
  );

  assert.match(pageSource, /BBApiBrowserTestClient/);
  assert.match(clientSource, /"use client"/);
  assert.match(clientSource, /credentials:\s*"include"/);
  assert.match(clientSource, /login\.aspx/);
  assert.match(clientSource, /countries\.aspx/);
  assert.match(clientSource, /logout\.aspx/);
  assert.match(clientSource, /return String\(error\);/);
  assert.doesNotMatch(clientSource, /BBXmlApiClient/);
  assert.doesNotMatch(clientSource, /@\/lib\/bbapi/);
  assert.doesNotMatch(clientSource, /fetch\(["'`]\/api/);
  assert.doesNotMatch(clientSource, /browser did not expose/i);
  assert.doesNotMatch(clientSource, /\[redacted\]/);
});
