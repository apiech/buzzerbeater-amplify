import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readmeEnvSectionEnd,
  readmeEnvSectionStart,
  renderEnvTemplate,
  renderReadmeEnvSection,
} from "./env-contract.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..");
const envTemplatePath = join(projectRoot, "env-template");
const readmePath = join(projectRoot, "README.md");

export function applyReadmeEnvSection(source) {
  const startIndex = source.indexOf(readmeEnvSectionStart);
  const endIndex = source.indexOf(readmeEnvSectionEnd);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("README.md is missing the env-contract marker block.");
  }

  const before = source.slice(0, startIndex);
  const after = source.slice(endIndex + readmeEnvSectionEnd.length);
  return `${before}${renderReadmeEnvSection()}${after}`;
}

export async function main() {
  const readmeSource = await readFile(readmePath, "utf8");
  await writeFile(envTemplatePath, renderEnvTemplate(), "utf8");
  await writeFile(readmePath, applyReadmeEnvSection(readmeSource), "utf8");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
