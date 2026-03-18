import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import publicAppOrigin from "../lib/env/public-app-origin.ts";
import { loadProjectEnvFiles } from "./project-env.mjs";

const { deriveAmplifyAppOrigin } = publicAppOrigin;

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");
const nextCli = require.resolve("next/dist/bin/next");

function loadLocalEnv() {
  loadProjectEnvFiles(projectRoot);
}

loadLocalEnv();

const derivedEnv = {
  ...process.env,
  AMPLIFY_APP_ORIGIN: deriveAmplifyAppOrigin(process.env),
};

const child = spawn(process.execPath, [nextCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: derivedEnv,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
