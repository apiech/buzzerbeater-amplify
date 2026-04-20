import type { ResourcesConfig } from "@aws-amplify/core";
import { importAmplifyOutputsModule } from "@/app/amplify-outputs-runtime.js";
import {
  applyCognitoAuthDomainOverride,
  readAuthDomainRuntimeEnv,
  resolveCognitoAuthCustomDomainOverride,
} from "@/lib/env/auth-domain";

type AmplifyOutputsLoader = () => Promise<ResourcesConfig>;
type AmplifyOutputsModule = {
  readonly default?: unknown;
};
type RuntimeEnvReader = () => Record<string, string | undefined>;

const missingOutputsMessage =
  "amplify_outputs.json is not available. Pure validation phases must not require generated outputs; only real Amplify runtime construction may load them after backend deployment.";

let amplifyOutputs: ResourcesConfig | null = null;
let amplifyOutputsPromise: Promise<ResourcesConfig> | null = null;
let amplifyOutputsLoader: AmplifyOutputsLoader = defaultAmplifyOutputsLoader;
let runtimeEnvReader: RuntimeEnvReader = readAuthDomainRuntimeEnv;

export class AmplifyOutputsUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      cause instanceof Error
        ? `${missingOutputsMessage} Original error: ${cause.message}`
        : missingOutputsMessage,
      { cause },
    );
    this.name = "AmplifyOutputsUnavailableError";
  }
}

export async function loadAmplifyOutputs(): Promise<ResourcesConfig> {
  if (amplifyOutputs) {
    return amplifyOutputs;
  }

  if (!amplifyOutputsPromise) {
    amplifyOutputsPromise = amplifyOutputsLoader()
      .then((outputs) => {
        const resolvedOutputs = applyCustomAuthDomainOverride(outputs);
        amplifyOutputs = resolvedOutputs;
        return resolvedOutputs;
      })
      .catch((error) => {
        amplifyOutputsPromise = null;
        throw toAmplifyOutputsError(error);
      });
  }

  return amplifyOutputsPromise;
}

async function defaultAmplifyOutputsLoader(): Promise<ResourcesConfig> {
  const outputsModule =
    (await importAmplifyOutputsModule()) as AmplifyOutputsModule;
  return normalizeAmplifyOutputs(outputsModule);
}

function normalizeAmplifyOutputs(module: unknown): ResourcesConfig {
  const maybeModule = module as AmplifyOutputsModule;
  return (maybeModule.default ?? module) as ResourcesConfig;
}

function applyCustomAuthDomainOverride(
  outputs: ResourcesConfig,
): ResourcesConfig {
  return applyCognitoAuthDomainOverride(
    outputs,
    resolveCognitoAuthCustomDomainOverride(runtimeEnvReader()),
  );
}

function toAmplifyOutputsError(
  error: unknown,
): AmplifyOutputsUnavailableError {
  if (error instanceof AmplifyOutputsUnavailableError) {
    return error;
  }

  return new AmplifyOutputsUnavailableError(error);
}

function resetAmplifyOutputsCache(): void {
  amplifyOutputs = null;
  amplifyOutputsPromise = null;
}

export const __testing = {
  installLoader(loader: AmplifyOutputsLoader) {
    const previousLoader = amplifyOutputsLoader;
    amplifyOutputsLoader = loader;
    resetAmplifyOutputsCache();
    return () => {
      amplifyOutputsLoader = previousLoader;
      resetAmplifyOutputsCache();
    };
  },
  installRuntimeEnvReader(reader: RuntimeEnvReader) {
    const previousReader = runtimeEnvReader;
    runtimeEnvReader = reader;
    resetAmplifyOutputsCache();
    return () => {
      runtimeEnvReader = previousReader;
      resetAmplifyOutputsCache();
    };
  },
  applyCustomAuthDomainOverride,
  normalizeAmplifyOutputs,
  resetCache: resetAmplifyOutputsCache,
  toAmplifyOutputsError,
};
