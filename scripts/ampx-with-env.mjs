import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import process from "node:process";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");
const envFile = join(projectRoot, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["ampx", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
