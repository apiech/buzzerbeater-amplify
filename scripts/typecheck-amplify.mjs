import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedEnvDir = join(repoRoot, ".amplify", "generated", "env");

if (
  !existsSync(generatedEnvDir) ||
  readdirSync(generatedEnvDir).length === 0
) {
  console.error(
    [
      "Amplify generated env modules are missing.",
      "Bootstrap them by running `npm run sandbox:once`, then rerun `npm run typecheck:amplify`.",
    ].join(" "),
  );
  process.exit(1);
}

const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");
const result = spawnSync(tscPath, ["-p", "amplify/tsconfig.json", "--noEmit"], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
