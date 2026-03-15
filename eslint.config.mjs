import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

const repoRoot = dirname(fileURLToPath(import.meta.url));

const frontendFiles = ["app/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"];
const frontendTypeFiles = ["app/**/*.ts", "app/**/*.tsx"];
const backendTypeFiles = ["amplify/**/*.ts"];
const sharedTypeFiles = [
  "lib/**/*.ts",
  "infra/**/*.ts",
  "scripts/**/*.ts",
];
const testTypeFiles = ["tests/**/*.ts"];
const nodeConfigFiles = ["*.js", "*.mjs"];

const ignores = [
  ".amplify/**",
  ".next/**",
  "cdk.out/**",
  "node_modules/**",
  "node_modules.bak.*/**",
  "out/**",
  "build/**",
  "amplify_outputs.json",
  "next-env.d.ts",
  "amplify/env.d.ts",
];

const typeImportRule = [
  "error",
  {
    prefer: "type-imports",
    fixStyle: "separate-type-imports",
  },
];

const unusedVarsRule = [
  "warn",
  {
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
    destructuredArrayIgnorePattern: "^_",
  },
];

const withFrontendFiles = nextVitals
  .filter((entry) => !("ignores" in entry))
  .map((entry) => ({
    ...entry,
    files: frontendFiles,
  }));

function typedLanguage(project, extraGlobals) {
  return {
    parser: tseslint.parser,
    parserOptions: {
      project: [project],
      tsconfigRootDir: repoRoot,
    },
    globals: extraGlobals,
  };
}

export default [
  {
    ignores,
  },
  ...withFrontendFiles,
  {
    files: nodeConfigFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "module",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
    },
  },
  {
    files: frontendTypeFiles,
    languageOptions: typedLanguage("./tsconfig.eslint.frontend.json", {
      ...globals.browser,
      ...globals.node,
    }),
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": typeImportRule,
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: backendTypeFiles,
    languageOptions: typedLanguage("./tsconfig.eslint.backend.json", {
      ...globals.node,
      fetch: "readonly",
      Headers: "readonly",
      Request: "readonly",
      Response: "readonly",
    }),
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": typeImportRule,
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": "off",
    },
  },
  {
    files: sharedTypeFiles,
    languageOptions: typedLanguage("./tsconfig.eslint.node.json", {
      ...globals.node,
      fetch: "readonly",
      Headers: "readonly",
      Request: "readonly",
      Response: "readonly",
    }),
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/consistent-type-imports": typeImportRule,
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "no-console": "off",
    },
  },
  {
    files: testTypeFiles,
    languageOptions: typedLanguage("./tsconfig.eslint.node.json", {
      ...globals.node,
      fetch: "readonly",
      Headers: "readonly",
      Request: "readonly",
      Response: "readonly",
    }),
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/consistent-type-imports": typeImportRule,
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "no-console": "off",
    },
  },
];
