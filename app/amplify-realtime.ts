"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";

import type { Schema } from "@/amplify/data/resource";
import outputs from "@/amplify_outputs.json";

type RealtimeClient = ReturnType<typeof generateClient<Schema>>;

let realtimeClient: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (realtimeClient) {
    return realtimeClient;
  }

  Amplify.configure(outputs);
  realtimeClient = generateClient<Schema>();
  return realtimeClient;
}

export function logRealtimeError(context: string) {
  return (error: unknown): void => {
    console.error(`[amplify-realtime] ${context}`, error);
  };
}
