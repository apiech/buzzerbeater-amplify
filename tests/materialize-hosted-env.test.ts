import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { envContract } from "../scripts/env-contract.mjs";
import {
  renderHostedRuntimeEnvFile,
  writeHostedRuntimeEnvFile,
} from "../scripts/materialize-hosted-env.mjs";

test("renderHostedRuntimeEnvFile exports contract-defined non-secret env and derived public origin", () => {
  const hostedEnv = Object.fromEntries(
    [...envContract.plain.required, ...envContract.plain.optional].map(
      (entry) => [entry.name, `value_for_${entry.name.toLowerCase()}`],
    ),
  ) as Record<string, string>;

  hostedEnv.APP_BASE_URL = "https://dev.bringmeacat.com";
  hostedEnv.BB_CONNECTION_ENCRYPTION_SECRET = "secret";
  hostedEnv.AWS_BRANCH = "dev";
  hostedEnv.NEXT_PUBLIC_ANALYTICS_ID = "analytics-123";

  const source = renderHostedRuntimeEnvFile(hostedEnv);

  for (const entry of [
    ...envContract.plain.required,
    ...envContract.plain.optional,
  ]) {
    assert.match(source, new RegExp(`^${entry.name}=`, "m"));
  }

  assert.match(source, /^APP_BASE_URL=https:\/\/dev\.bringmeacat\.com$/m);
  assert.match(source, /^AMPLIFY_APP_ORIGIN=https:\/\/dev\.bringmeacat\.com$/m);
  assert.match(source, /^MAINTENANCE_ENVIRONMENT_NAME=dev$/m);
  assert.match(source, /^NEXT_PUBLIC_ANALYTICS_ID=analytics-123$/m);
  assert.doesNotMatch(source, /^BB_CONNECTION_ENCRYPTION_SECRET=/m);
  assert.doesNotMatch(source, /^AWS_BRANCH=/m);
});

test("writeHostedRuntimeEnvFile overwrites stale env contents", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-hosted-env-"));
  const envFilePath = join(tempDir, ".env.production");

  try {
    writeFileSync(envFilePath, "STALE=true\n", "utf8");

    writeHostedRuntimeEnvFile(envFilePath, {
      APP_BASE_URL: "https://bringmeacat.com",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_ANALYTICS_ID: "analytics-456",
    });

    const written = readFileSync(envFilePath, "utf8");
    assert.match(written, /^APP_BASE_URL=https:\/\/bringmeacat\.com$/m);
    assert.match(written, /^AMPLIFY_APP_ORIGIN=https:\/\/bringmeacat\.com$/m);
    assert.match(written, /^MAINTENANCE_ENVIRONMENT_NAME=prod$/m);
    assert.match(written, /^NEXT_PUBLIC_ANALYTICS_ID=analytics-456$/m);
    assert.doesNotMatch(written, /^STALE=true$/m);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("renderHostedRuntimeEnvFile fails when APP_BASE_URL is missing", () => {
  assert.throws(
    () =>
      renderHostedRuntimeEnvFile({
        NEXT_PUBLIC_ANALYTICS_ID: "analytics-123",
      }),
    /APP_BASE_URL must be configured before building hosted Next\.js artifacts\./,
  );
});
