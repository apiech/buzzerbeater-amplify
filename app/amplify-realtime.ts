"use client";

import { Amplify } from "aws-amplify";
import { generateClient, type Client } from "aws-amplify/data";
import type { ResourcesConfig } from "@aws-amplify/core";

import type { Schema } from "@/amplify/data/resource";
import { loadAmplifyOutputs } from "@/app/amplify-outputs";

type RealtimeClient = Client<Schema>;
type ConfigureAmplify = (outputs: ResourcesConfig) => void;
type CreateRealtimeClient = () => RealtimeClient;
type RealtimeLogMetadata = Record<string, unknown>;
type RealtimeLogHandler = typeof console.log;
type WindowWithLogLevel = Window & {
  LOG_LEVEL?: unknown;
};
type RealtimeDiagnosticState = {
  lines: string[];
  restoreLogLevel: () => void;
};

const realtimeDiagnosticLogLevel = "DEBUG";
const defaultRealtimeDiagnosticDurationMs = 15_000;
const maxRealtimeDiagnosticLines = 10;

let realtimeClientPromise: Promise<RealtimeClient> | null = null;
let configureAmplify: ConfigureAmplify = (outputs) => {
  Amplify.configure(outputs);
};
let createRealtimeClient: CreateRealtimeClient = () => generateClient<Schema>();
let originalConsoleLog: RealtimeLogHandler | null = null;
let originalConsoleWarn: RealtimeLogHandler | null = null;
const activeRealtimeDiagnostics = new Map<string, RealtimeDiagnosticState>();
const recentRealtimeDiagnostics = new Map<string, string[]>();

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

  return realtimeClientPromise;
}

export function logRealtimeError(context: string) {
  return (error: unknown, metadata?: RealtimeLogMetadata): void => {
    const summary = summarizeRealtimeError(error);
    const diagnosticContext = normalizeString(metadata?.diagnosticContext);
    const diagnosticSummary = diagnosticContext
      ? summarizeRealtimeDiagnosticLogs(diagnosticContext)
      : null;
    const message = buildRealtimeErrorMessage(summary, diagnosticSummary);

    if (summary) {
      console.error(
        `[amplify-realtime] ${context}: ${message}`,
        metadata ? { ...metadata, error } : error,
      );
      return;
    }

    console.error(
      `[amplify-realtime] ${context}${message ? `: ${message}` : ""}`,
      metadata ? { ...metadata, error } : error,
    );
  };
}

export function enableTemporaryAmplifyDebugLogging(
  context: string,
  options: {
    durationMs?: number;
    metadata?: RealtimeLogMetadata;
  } = {},
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const targetWindow = window as WindowWithLogLevel;
  const currentLevel = normalizeLogLevel(targetWindow.LOG_LEVEL);
  if (
    currentLevel === realtimeDiagnosticLogLevel ||
    currentLevel === "VERBOSE"
  ) {
    return () => {};
  }

  const durationMs =
    options.durationMs ?? defaultRealtimeDiagnosticDurationMs;
  const previousLogLevel = targetWindow.LOG_LEVEL;
  let timeoutId: number | null = null;
  let restored = false;
  const state: RealtimeDiagnosticState = {
    lines: [],
    restoreLogLevel: () => {
      if (previousLogLevel === undefined) {
        delete targetWindow.LOG_LEVEL;
      } else {
        targetWindow.LOG_LEVEL = previousLogLevel;
      }
    },
  };

  activeRealtimeDiagnostics.set(context, state);
  installRealtimeDiagnosticCapture();

  const restore = () => {
    if (restored) {
      return;
    }

    restored = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }

    recentRealtimeDiagnostics.set(context, [...state.lines]);
    activeRealtimeDiagnostics.delete(context);
    state.restoreLogLevel();
    uninstallRealtimeDiagnosticCapture();
  };

  targetWindow.LOG_LEVEL = realtimeDiagnosticLogLevel;
  console.info(`[amplify-realtime] ${context}.diagnostic`, {
    durationMs,
    logLevel: realtimeDiagnosticLogLevel,
    ...(options.metadata ?? {}),
  });
  timeoutId = window.setTimeout(() => {
    restore();
  }, durationMs);

  return restore;
}

function summarizeRealtimeError(error: unknown): string | null {
  const messages: string[] = [];
  collectRealtimeErrorMessages(error, messages, new Set<object>());
  if (!messages.length) {
    return null;
  }

  return messages.join(" | ");
}

function buildRealtimeErrorMessage(
  summary: string | null,
  diagnosticSummary: string | null,
): string | null {
  if (summary && diagnosticSummary) {
    return `${summary} | Recent Amplify logs: ${diagnosticSummary}`;
  }

  return summary ?? diagnosticSummary;
}

function summarizeRealtimeDiagnosticLogs(context: string): string | null {
  const activeLines = activeRealtimeDiagnostics.get(context)?.lines ?? [];
  const recentLines = recentRealtimeDiagnostics.get(context) ?? [];
  const lines = activeLines.length ? activeLines : recentLines;
  if (!lines.length) {
    return null;
  }

  return lines.join(" || ");
}

function installRealtimeDiagnosticCapture(): void {
  if (originalConsoleLog && originalConsoleWarn) {
    return;
  }

  originalConsoleLog = console.log.bind(console);
  originalConsoleWarn = console.warn.bind(console);

  console.log = (...args: unknown[]) => {
    originalConsoleLog?.(...args);
    captureRealtimeDiagnosticLine(args);
  };
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn?.(...args);
    captureRealtimeDiagnosticLine(args);
  };
}

function uninstallRealtimeDiagnosticCapture(): void {
  if (activeRealtimeDiagnostics.size > 0) {
    return;
  }

  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  if (originalConsoleWarn) {
    console.warn = originalConsoleWarn;
    originalConsoleWarn = null;
  }
}

function captureRealtimeDiagnosticLine(args: unknown[]): void {
  if (activeRealtimeDiagnostics.size === 0) {
    return;
  }

  const line = stringifyRealtimeDiagnosticArgs(args);
  if (!line || !isRelevantRealtimeDiagnosticLine(line)) {
    return;
  }

  activeRealtimeDiagnostics.forEach((diagnostic) => {
    diagnostic.lines.push(line);
    if (diagnostic.lines.length > maxRealtimeDiagnosticLines) {
      diagnostic.lines.splice(
        0,
        diagnostic.lines.length - maxRealtimeDiagnosticLines,
      );
    }
  });
}

function stringifyRealtimeDiagnosticArgs(args: unknown[]): string | null {
  const parts = args
    .map((value) => stringifyRealtimeDiagnosticValue(value))
    .filter((value): value is string => Boolean(value));
  if (!parts.length) {
    return null;
  }

  return parts.join(" ");
}

function stringifyRealtimeDiagnosticValue(value: unknown): string | null {
  const stringValue = normalizeString(value);
  if (stringValue) {
    return stringValue;
  }

  if (value instanceof Error) {
    return value.message || value.name || null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRelevantRealtimeDiagnosticLine(line: string): boolean {
  if (line.startsWith("[amplify-realtime]")) {
    return false;
  }

  return /(appsync|subscription|websocket|connection|graphql|realtime|api)/i.test(
    line,
  );
}

function collectRealtimeErrorMessages(
  value: unknown,
  messages: string[],
  seen: Set<object>,
): void {
  const stringValue = normalizeString(value);
  if (stringValue) {
    pushRealtimeErrorMessage(messages, stringValue);
    return;
  }

  if (value instanceof Error) {
    const name = normalizeString(value.name);
    const message = normalizeString(value.message);
    const summary =
      name && message && message !== name ? `${name}: ${message}` : message ?? name;
    pushRealtimeErrorMessage(messages, summary);
    collectRealtimeErrorMessages(
      (value as Error & { cause?: unknown }).cause,
      messages,
      seen,
    );
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRealtimeErrorMessages(item, messages, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  pushRealtimeErrorMessage(messages, summarizeRealtimeErrorRecord(record));

  for (const key of [
    "errors",
    "cause",
    "originalError",
    "underlyingError",
    "details",
    "data",
    "payload",
    "error",
  ]) {
    collectRealtimeErrorMessages(record[key], messages, seen);
  }
}

function summarizeRealtimeErrorRecord(
  record: Record<string, unknown>,
): string | null {
  const message =
    normalizeString(record.message) ?? normalizeString(record.errorMessage);
  const errorType = normalizeString(record.errorType);
  const errorCode = normalizeString(record.errorCode);
  const recoverySuggestion = normalizeString(record.recoverySuggestion);
  const label = [errorType, errorCode].filter(Boolean).join("/");

  if (label && message) {
    return `${label}: ${message}`;
  }
  if (message) {
    return message;
  }
  if (label) {
    return label;
  }
  if (recoverySuggestion) {
    return `Recovery suggestion: ${recoverySuggestion}`;
  }

  return null;
}

function pushRealtimeErrorMessage(
  messages: string[],
  message: string | null,
): void {
  if (!message || messages.includes(message)) {
    return;
  }

  messages.push(message);
}

function normalizeLogLevel(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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
  resetDiagnostics() {
    recentRealtimeDiagnostics.clear();
    activeRealtimeDiagnostics.clear();
    uninstallRealtimeDiagnosticCapture();
  },
  summarizeRealtimeError,
  summarizeRealtimeDiagnosticLogs,
};
