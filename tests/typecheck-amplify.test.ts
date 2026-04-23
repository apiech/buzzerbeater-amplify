import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  allowMissingGeneratedEnvFlag,
  formatGeneratedEnvMessage,
  missingGeneratedEnvMessage,
  runAmplifyTypecheck,
  skippedGeneratedEnvMessage,
} from "../scripts/typecheck-amplify.mjs";

function createTypecheckFixture(
  t: { after: (callback: () => void) => void },
  options: {
    envModuleNames?: string[];
    sourceFiles?: Record<string, string>;
  } = {},
) {
  const rootDir = mkdtempSync(join(os.tmpdir(), "typecheck-amplify-"));
  const envDir = join(rootDir, ".amplify", "generated", "env");
  const {
    envModuleNames = [],
    sourceFiles = {},
  } = options;

  t.after(() => {
    rmSync(rootDir, { force: true, recursive: true });
  });

  for (const [relativePath, source] of Object.entries(sourceFiles)) {
    const absolutePath = join(rootDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }

  mkdirSync(envDir, { recursive: true });
  for (const moduleName of envModuleNames) {
    writeFileSync(join(envDir, `${moduleName}.ts`), "export const env = {};\n");
  }

  return {
    envDir,
    rootDir,
  };
}

test("runAmplifyTypecheck fails when generated env modules are missing", () => {
  const errors: string[] = [];
  let spawned = false;

  const exitCode = runAmplifyTypecheck([], {
    envDir: "/tmp/nonexistent-generated-env",
    error: (message) => {
      errors.push(String(message));
    },
    exists: () => false,
    rootDir: "/tmp/nonexistent-generated-env-root",
    spawn: () => {
      spawned = true;
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(spawned, false);
  assert.deepStrictEqual(errors, [missingGeneratedEnvMessage]);
});

test("runAmplifyTypecheck skips cleanly when generated env modules are explicitly allowed to be missing", () => {
  const warnings: string[] = [];
  let spawned = false;

  const exitCode = runAmplifyTypecheck([allowMissingGeneratedEnvFlag], {
    envDir: "/tmp/nonexistent-generated-env",
    exists: () => false,
    rootDir: "/tmp/nonexistent-generated-env-root",
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

test("runAmplifyTypecheck fails when generated env modules are stale", (t) => {
  const errors: string[] = [];
  let spawned = false;
  const { envDir, rootDir } = createTypecheckFixture(t, {
    envModuleNames: ["set-bb-league-time-zone"],
    sourceFiles: {
      "amplify/data/foo.ts": [
        'import { env } from "$amplify/env/set-tracked-player-interview-personality";',
        'import { env as recapEnv } from "$amplify/env/game-day-recap-failure-finalizer";',
        "void env;",
        "void recapEnv;",
      ].join("\n"),
    },
  });

  const exitCode = runAmplifyTypecheck([], {
    envDir,
    error: (message) => {
      errors.push(String(message));
    },
    rootDir,
    spawn: () => {
      spawned = true;
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(spawned, false);
  assert.deepStrictEqual(errors, [
    formatGeneratedEnvMessage(missingGeneratedEnvMessage, [
      "game-day-recap-failure-finalizer",
      "set-tracked-player-interview-personality",
    ]),
  ]);
});

test("runAmplifyTypecheck skips cleanly when generated env modules are stale and skipping is allowed", (t) => {
  const warnings: string[] = [];
  let spawned = false;
  const { envDir, rootDir } = createTypecheckFixture(t, {
    envModuleNames: ["set-bb-league-time-zone"],
    sourceFiles: {
      "amplify/data/foo.ts": [
        'import { env } from "$amplify/env/set-tracked-player-interview-personality";',
        'import { env as recapEnv } from "$amplify/env/game-day-recap-failure-finalizer";',
        "void env;",
        "void recapEnv;",
      ].join("\n"),
    },
  });

  const exitCode = runAmplifyTypecheck([allowMissingGeneratedEnvFlag], {
    envDir,
    rootDir,
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
  assert.deepStrictEqual(warnings, [
    formatGeneratedEnvMessage(skippedGeneratedEnvMessage, [
      "game-day-recap-failure-finalizer",
      "set-tracked-player-interview-personality",
    ]),
  ]);
});

test("runAmplifyTypecheck shells out to the Amplify backend tsconfig when generated env coverage is complete", (t) => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];
  const { envDir, rootDir } = createTypecheckFixture(t, {
    envModuleNames: [
      "game-day-recap-failure-finalizer",
      "set-tracked-player-interview-personality",
    ],
    sourceFiles: {
      "amplify/data/foo.ts": [
        'import { env } from "$amplify/env/set-tracked-player-interview-personality";',
        'import { env as recapEnv } from "$amplify/env/game-day-recap-failure-finalizer";',
        "void env;",
        "void recapEnv;",
      ].join("\n"),
    },
  });

  const exitCode = runAmplifyTypecheck([], {
    envDir,
    rootDir,
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
        cwd: rootDir,
        stdio: "inherit",
      },
    },
  ]);
});
