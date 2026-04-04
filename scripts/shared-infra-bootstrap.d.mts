import type { PathLike } from "node:fs";
import type { SpawnSyncOptions } from "node:child_process";

export const sandboxIdentifierEnvName: "BB_SANDBOX_IDENTIFIER";
export const skipSandboxSharedInfraBootstrapEnvName: "BB_SKIP_SANDBOX_SHARED_INFRA_BOOTSTRAP";

export type SharedInfraBootstrapRuntime = {
  directoryExists?: (path: PathLike) => boolean;
  env?: NodeJS.ProcessEnv;
  execAwsJson?: (args: string[]) => unknown;
  spawnSync?: (
    command: string,
    args: string[],
    options?: SpawnSyncOptions,
  ) => {
    status: number | null;
    stderr?: string | Buffer | null;
    stdout?: string | Buffer | null;
  };
  userName?: () => string;
};

export type SharedInfraBootstrapCommand = {
  args: string[];
  command: string;
  environmentName: string;
  sandboxIdentifier: string;
};

export type SandboxPredictorReleaseCommand = {
  command: string;
  cwd: string;
  environmentName: string;
  sandboxIdentifier: string;
};

export type SandboxPredictorReadyResult = {
  endpointName: string;
  environmentName: string;
  region: string;
  sandboxIdentifier: string;
};

export type SandboxSharedInfraBootstrapResult = {
  environmentName: string;
  sandboxIdentifier: string;
};

export function shouldBootstrapSandboxSharedInfra(argv: string[]): boolean;
export function normalizeSandboxIdentifier(value: unknown): string;
export function resolveSandboxIdentifier(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): string;
export function resolveSandboxEnvironmentName(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): string;
export function createSharedInfraBootstrapCommand(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): SharedInfraBootstrapCommand;
export function buildSandboxPredictorReleaseCommand(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): SandboxPredictorReleaseCommand;
export function assertSandboxPredictorReady(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): SandboxPredictorReadyResult | null;
export function ensureResolvedSandboxIdentifierArgv(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): string[];
export function bootstrapSandboxSharedInfra(
  argv: string[],
  runtime?: SharedInfraBootstrapRuntime,
): SandboxSharedInfraBootstrapResult | null;
