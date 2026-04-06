import type { ResourcesConfig } from "@aws-amplify/core";

type AmplifyOutputsLoader = () => Promise<ResourcesConfig>;
type AmplifyOutputsModule = {
  readonly default?: ResourcesConfig;
};

const missingOutputsMessage =
  "amplify_outputs.json is not available. Pure validation phases must not require generated outputs; only real Amplify runtime construction may load them after backend deployment.";

let amplifyOutputs: ResourcesConfig | null = null;
let amplifyOutputsPromise: Promise<ResourcesConfig> | null = null;
let amplifyOutputsLoader: AmplifyOutputsLoader = defaultAmplifyOutputsLoader;

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
        amplifyOutputs = outputs;
        return outputs;
      })
      .catch((error) => {
        amplifyOutputsPromise = null;
        throw toAmplifyOutputsError(error);
      });
  }

  return amplifyOutputsPromise;
}

async function defaultAmplifyOutputsLoader(): Promise<ResourcesConfig> {
  const outputsModule = (await import("../amplify_outputs.json", {
    with: { type: "json" },
  })) as AmplifyOutputsModule;
  return normalizeAmplifyOutputs(outputsModule);
}

function normalizeAmplifyOutputs(
  module: AmplifyOutputsModule | ResourcesConfig,
): ResourcesConfig {
  return ((module as AmplifyOutputsModule).default ?? module) as ResourcesConfig;
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
  normalizeAmplifyOutputs,
  resetCache: resetAmplifyOutputsCache,
  toAmplifyOutputsError,
};
