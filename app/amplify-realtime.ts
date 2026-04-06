"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";

import type { Schema } from "@/amplify/data/resource";
import { loadAmplifyOutputs } from "@/app/amplify-outputs";

type RealtimeClient = ReturnType<typeof generateClient<Schema>>;
type ConfigureAmplify = (
  outputs: Awaited<ReturnType<typeof loadAmplifyOutputs>>,
) => void;
type CreateRealtimeClient = () => RealtimeClient;

let realtimeClientPromise: Promise<unknown> | null = null;
let configureAmplify: ConfigureAmplify = (outputs) => {
  Amplify.configure(outputs);
};
let createRealtimeClient: CreateRealtimeClient = () => generateClient<Schema>();

export function getRealtimeClient(): Promise<RealtimeClient> {
  if (!realtimeClientPromise) {
    realtimeClientPromise = loadAmplifyOutputs()
      .then((outputs) => {
        configureAmplify(outputs);
        return createRealtimeClient();
      })
      .catch((error) => {
        realtimeClientPromise = null;
        throw error;
      });
  }

  return realtimeClientPromise as Promise<RealtimeClient>;
}

export function logRealtimeError(context: string) {
  return (error: unknown): void => {
    console.error(`[amplify-realtime] ${context}`, error);
  };
}

function resetRealtimeClientCache(): void {
  realtimeClientPromise = null;
}

export const __testing = {
  installRuntime(runtime: {
    configureAmplify?: ConfigureAmplify;
    createRealtimeClient?: CreateRealtimeClient;
  }) {
    const previousConfigureAmplify = configureAmplify;
    const previousCreateRealtimeClient = createRealtimeClient;
    configureAmplify = runtime.configureAmplify ?? previousConfigureAmplify;
    createRealtimeClient =
      runtime.createRealtimeClient ?? previousCreateRealtimeClient;
    resetRealtimeClientCache();
    return () => {
      configureAmplify = previousConfigureAmplify;
      createRealtimeClient = previousCreateRealtimeClient;
      resetRealtimeClientCache();
    };
  },
  resetClientCache: resetRealtimeClientCache,
};
