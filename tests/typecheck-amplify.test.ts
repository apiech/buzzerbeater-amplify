import assert from "node:assert/strict";
import test from "node:test";

import {
  allowMissingGeneratedEnvFlag,
  missingGeneratedEnvMessage,
  runAmplifyTypecheck,
  skippedGeneratedEnvMessage,
} from "../scripts/typecheck-amplify.mjs";

test("runAmplifyTypecheck fails when generated env modules are missing", () => {
  const errors: string[] = [];
  let spawned = false;

  const exitCode = runAmplifyTypecheck([], {
    envDir: "/tmp/nonexistent-generated-env",
    error: (message) => {
      errors.push(String(message));
    },
    exists: () => false,
    spawn: () => {
      spawned = true;
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(spawned, false);
  assert.deepStrictEqual(errors, [missingGeneratedEnvMessage]);
});

test("runAmplifyTypecheck skips cleanly for sandbox preflight when generated env modules are missing", () => {
  const warnings: string[] = [];
  let spawned = false;

  const exitCode = runAmplifyTypecheck([allowMissingGeneratedEnvFlag], {
    envDir: "/tmp/nonexistent-generated-env",
    exists: () => false,
    spawn: () => {
      spawned = true;
      return { status: 0 };
    },
    warn: (message) => {
      warnings.push(String(message));
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(spawned, false);
  assert.deepStrictEqual(warnings, [skippedGeneratedEnvMessage]);
});

test("runAmplifyTypecheck shells out to the Amplify backend tsconfig when generated env modules exist", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  const exitCode = runAmplifyTypecheck([], {
    envDir: "/tmp/generated-env",
    exists: () => true,
    readDir: () => ["get-rivals-workspace.ts"],
    rootDir: "/repo",
    spawn: (command, args, options) => {
      calls.push({
        args: [...args],
        command,
        options: options as Record<string, unknown>,
      });
      return { status: 0 };
    },
    typecheckBinaryPath: "/repo/node_modules/.bin/tsc",
  });

  assert.equal(exitCode, 0);
  assert.deepStrictEqual(calls, [
    {
      args: ["-p", "amplify/tsconfig.json", "--noEmit"],
      command: "/repo/node_modules/.bin/tsc",
      options: {
        cwd: "/repo",
        stdio: "inherit",
      },
    },
  ]);
});
