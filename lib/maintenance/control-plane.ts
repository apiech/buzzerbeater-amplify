import {
  DeleteParameterCommand,
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { z } from "zod";

import {
  buildMaintenanceParameterName,
  readMaintenanceRuntimeEnv,
  readMaintenanceRuntimeUserName,
  resolveMaintenanceEnvironmentName,
} from "./environment";

const maintenanceReasonCodeSchema = z.enum([
  "MANUAL",
  "BUDGET_GUARDRAIL",
  "LLM_OUTAGE",
  "BB_API_OUTAGE",
  "DEPENDENCY_OUTAGE",
]);
const maintenanceSourceSchema = z.enum(["MANUAL", "ALARM"]);

const maintenanceDocumentSchema = z
  .object({
    mode: z.literal("FULL_SITE"),
    scope: z.literal("SITE"),
    reasonCode: maintenanceReasonCodeSchema,
    headline: z.string().trim().min(1).max(160),
    detail: z.string().trim().min(1).max(4_000),
    expectedRecoveryAt: z.string().datetime().nullable().optional(),
    source: maintenanceSourceSchema,
    triggerService: z.string().trim().min(1).max(120).nullable().optional(),
    triggerId: z.string().trim().min(1).max(240).nullable().optional(),
    activatedAt: z.string().datetime(),
    activatedBy: z.string().trim().min(1).max(120),
  })
  .strict()
  .transform((value) => ({
    ...value,
    expectedRecoveryAt: value.expectedRecoveryAt ?? null,
    triggerId: value.triggerId ?? null,
    triggerService: value.triggerService ?? null,
  }));

type MaintenanceDocumentInput = z.input<typeof maintenanceDocumentSchema>;
export type MaintenanceReasonCode = z.infer<typeof maintenanceReasonCodeSchema>;
export type MaintenanceSource = z.infer<typeof maintenanceSourceSchema>;
export type MaintenanceDocument = z.infer<typeof maintenanceDocumentSchema>;

export type MaintenanceState = {
  active: boolean;
  document: MaintenanceDocument | null;
  environmentName: string;
  parameterName: string;
  stale: boolean;
};

type Runtime = {
  deleteParameter(
    name: string,
    options: {
      region: string;
    },
  ): Promise<void>;
  getParameter(
    name: string,
    options: {
      region: string;
    },
  ): Promise<string | null>;
  now(): Date;
  putParameter(
    name: string,
    value: string,
    options: {
      overwrite: boolean;
      region: string;
    },
  ): Promise<void>;
  userName(): string;
};

type MaintenanceContext = {
  environmentName: string;
  parameterName: string;
  region: string;
};

type ActivateMaintenanceArgs = {
  activatedBy: string;
  detail: string;
  env?: Record<string, string | undefined>;
  expectedRecoveryAt?: string | null;
  headline: string;
  reasonCode: MaintenanceReasonCode;
  source: MaintenanceSource;
  triggerId?: string | null;
  triggerService?: string | null;
};

type ActivateMaintenanceResult = {
  changed: boolean;
  state: MaintenanceState;
};

type RuntimeInstallInput = Partial<Runtime>;

const clientCache = new Map<string, SSMClient>();
const stateCache = new Map<string, MaintenanceState>();

let runtime: Runtime = createDefaultRuntime();

export class MaintenanceModeError extends Error {
  readonly document: MaintenanceDocument;

  constructor(document: MaintenanceDocument) {
    super(buildMaintenanceErrorMessage(document));
    this.document = document;
    this.name = "MaintenanceModeError";
  }
}

export const __testing = {
  classifySsmError,
  createContext,
  installRuntime(input: RuntimeInstallInput) {
    const previousRuntime = runtime;
    runtime = {
      ...runtime,
      ...input,
    };
    resetCachedState();
    return () => {
      runtime = previousRuntime;
      resetCachedState();
    };
  },
  maintenanceDocumentSchema,
  parseMaintenanceDocument,
  resetCachedState,
};

export async function getMaintenanceState(
  env: Record<string, string | undefined> = readMaintenanceRuntimeEnv(),
): Promise<MaintenanceState> {
  const context = createContext(env);

  try {
    const rawValue = await runtime.getParameter(context.parameterName, {
      region: context.region,
    });
    if (!rawValue) {
      return cacheAndReturn({
        active: false,
        document: null,
        environmentName: context.environmentName,
        parameterName: context.parameterName,
        stale: false,
      });
    }

    return cacheAndReturn({
      active: true,
      document: parseMaintenanceDocument(rawValue),
      environmentName: context.environmentName,
      parameterName: context.parameterName,
      stale: false,
    });
  } catch (error) {
    const errorKind = classifySsmError(error);
    if (errorKind === "missing") {
      return cacheAndReturn({
        active: false,
        document: null,
        environmentName: context.environmentName,
        parameterName: context.parameterName,
        stale: false,
      });
    }

    if (errorKind === "transient") {
      const cachedState = stateCache.get(context.parameterName);
      if (cachedState) {
        return {
          ...cachedState,
          stale: true,
        };
      }

      return {
        active: false,
        document: null,
        environmentName: context.environmentName,
        parameterName: context.parameterName,
        stale: true,
      };
    }

    throw error;
  }
}

export async function assertMaintenanceInactive(
  env: Record<string, string | undefined> = readMaintenanceRuntimeEnv(),
): Promise<void> {
  const state = await getMaintenanceState(env);
  if (state.active && state.document) {
    throw new MaintenanceModeError(state.document);
  }
}

export async function activateMaintenance(
  args: ActivateMaintenanceArgs,
): Promise<ActivateMaintenanceResult> {
  const env = args.env ?? readMaintenanceRuntimeEnv();
  const context = createContext(env);
  const existingState = await getMaintenanceState(env);

  if (
    args.source === "ALARM" &&
    existingState.active &&
    existingState.document?.source === "MANUAL"
  ) {
    return {
      changed: false,
      state: existingState,
    };
  }

  const nextDocument = maintenanceDocumentSchema.parse({
    activatedAt: runtime.now().toISOString(),
    activatedBy: args.activatedBy,
    detail: args.detail,
    expectedRecoveryAt: args.expectedRecoveryAt ?? null,
    headline: args.headline,
    mode: "FULL_SITE",
    reasonCode: args.reasonCode,
    scope: "SITE",
    source: args.source,
    triggerId: args.triggerId ?? null,
    triggerService: args.triggerService ?? null,
  } satisfies MaintenanceDocumentInput);
  const nextSerialized = JSON.stringify(nextDocument);

  await runtime.putParameter(context.parameterName, nextSerialized, {
    overwrite: true,
    region: context.region,
  });

  const nextState = cacheAndReturn({
    active: true,
    document: nextDocument,
    environmentName: context.environmentName,
    parameterName: context.parameterName,
    stale: false,
  });

  return {
    changed:
      !existingState.active ||
      JSON.stringify(existingState.document) !== nextSerialized,
    state: nextState,
  };
}

export async function clearMaintenance(
  env: Record<string, string | undefined> = readMaintenanceRuntimeEnv(),
): Promise<MaintenanceState> {
  const context = createContext(env);

  try {
    await runtime.deleteParameter(context.parameterName, {
      region: context.region,
    });
  } catch (error) {
    if (classifySsmError(error) !== "missing") {
      throw error;
    }
  }

  return cacheAndReturn({
    active: false,
    document: null,
    environmentName: context.environmentName,
    parameterName: context.parameterName,
    stale: false,
  });
}

export function buildMaintenanceErrorMessage(
  document: Pick<MaintenanceDocument, "headline" | "reasonCode">,
): string {
  return `MAINTENANCE:${document.reasonCode} ${document.headline}`.trim();
}

export function isMaintenanceModeError(
  error: unknown,
): error is MaintenanceModeError {
  return error instanceof MaintenanceModeError;
}

function cacheAndReturn(state: MaintenanceState): MaintenanceState {
  stateCache.set(state.parameterName, state);
  return state;
}

function createContext(
  env: Record<string, string | undefined>,
): MaintenanceContext {
  const environmentName = resolveMaintenanceEnvironmentName(env, {
    userName: runtime.userName,
  });

  return {
    environmentName,
    parameterName: buildMaintenanceParameterName(environmentName),
    region: resolveAwsRegion(env),
  };
}

function createDefaultRuntime(): Runtime {
  return {
    async deleteParameter(name, options) {
      const client = getClient(options.region);
      await client.send(
        new DeleteParameterCommand({
          Name: name,
        }),
      );
    },
    async getParameter(name, options) {
      const client = getClient(options.region);
      const response = await client.send(
        new GetParameterCommand({
          Name: name,
        }),
      );
      return response.Parameter?.Value ?? null;
    },
    now: () => new Date(),
    async putParameter(name, value, options) {
      const client = getClient(options.region);
      await client.send(
        new PutParameterCommand({
          Name: name,
          Overwrite: options.overwrite,
          Type: "String",
          Value: value,
        }),
      );
    },
    userName: () => readMaintenanceRuntimeUserName(),
  };
}

function getClient(region: string): SSMClient {
  const cacheKey = region || "default";
  const existing = clientCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const client = new SSMClient(region ? { region } : {});
  clientCache.set(cacheKey, client);
  return client;
}

function parseMaintenanceDocument(value: string): MaintenanceDocument {
  return maintenanceDocumentSchema.parse(JSON.parse(value));
}

function resolveAwsRegion(env: Record<string, string | undefined>): string {
  return (
    normalizeOptionalString(env.AWS_REGION) ??
    normalizeOptionalString(env.AWS_DEFAULT_REGION) ??
    "us-east-1"
  );
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resetCachedState(): void {
  clientCache.clear();
  stateCache.clear();
}

function classifySsmError(error: unknown): "missing" | "transient" | "other" {
  const name =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const statusCode =
    typeof error === "object" &&
    error &&
    "$metadata" in error &&
    typeof (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
      ?.httpStatusCode === "number"
      ? Number(
          (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
            ?.httpStatusCode,
        )
      : null;

  if (name === "ParameterNotFound") {
    return "missing";
  }

  if (
    new Set([
      "AccessDenied",
      "AccessDeniedException",
      "AuthFailure",
      "ExpiredTokenException",
      "InternalServerError",
      "InvalidSignatureException",
      "NetworkingError",
      "RequestTimeout",
      "ServiceUnavailableException",
      "ThrottlingException",
      "TimeoutError",
      "TooManyRequestsException",
      "UnauthorizedException",
      "UnauthorizedOperation",
      "UnrecognizedClientException",
    ]).has(name)
  ) {
    return "transient";
  }

  if (message && /access denied|not authorized|unauthorized/i.test(message)) {
    return "transient";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "transient";
  }

  if (statusCode !== null && statusCode >= 500) {
    return "transient";
  }

  return "other";
}
