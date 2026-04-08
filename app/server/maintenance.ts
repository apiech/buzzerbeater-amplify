import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";

import {
  getMaintenanceState,
  isMaintenanceModeError,
  type MaintenanceDocument,
  type MaintenanceState,
} from "@/lib/maintenance/control-plane";
import {
  buildMaintenanceParameterName,
  readMaintenanceRuntimeEnv,
  resolveMaintenanceEnvironmentName,
} from "@/lib/maintenance/environment";

type MaintenanceApiPayload = {
  data: null;
  errors: Array<{
    message: string;
  }>;
  maintenance: {
    active: true;
    state: MaintenanceDocument;
  };
};

export const __testing = {
  createFailOpenMaintenanceState,
  getMaintenanceState,
};

export async function getServerMaintenanceState(): Promise<MaintenanceState> {
  const env = readMaintenanceRuntimeEnv();

  try {
    return await getMaintenanceState(env);
  } catch (error) {
    console.error(
      "[maintenance] Failed to read maintenance state in server runtime. Failing open.",
      error,
    );
    return createFailOpenMaintenanceState(env);
  }
}

export async function redirectToStatusIfMaintenanceActive(): Promise<void> {
  const state = await getServerMaintenanceState();
  if (state.active) {
    redirect("/status");
  }
}

export async function maybeCreateMaintenanceRedirectResponse(
  request: Pick<NextRequest, "url"> | URL | { url: string },
): Promise<NextResponse | null> {
  const state = await getServerMaintenanceState();
  if (!state.active) {
    return null;
  }

  return NextResponse.redirect(new URL("/status", readRequestUrl(request)), {
    status: 307,
  });
}

export function createMaintenanceApiResponse(
  document: MaintenanceDocument,
): NextResponse<MaintenanceApiPayload> {
  return NextResponse.json(
    {
      data: null,
      errors: [
        {
          message: document.headline,
        },
      ],
      maintenance: {
        active: true,
        state: document,
      },
    },
    { status: 503 },
  );
}

export function toMaintenanceApiResponse(error: unknown): NextResponse | null {
  if (!isMaintenanceModeError(error)) {
    return null;
  }

  return createMaintenanceApiResponse(error.document);
}

function createFailOpenMaintenanceState(
  env: Record<string, string | undefined> = readMaintenanceRuntimeEnv(),
): MaintenanceState {
  const environmentName = resolveMaintenanceEnvironmentName(env);
  return {
    active: false,
    document: null,
    environmentName,
    parameterName: buildMaintenanceParameterName(environmentName),
    stale: true,
  };
}

function readRequestUrl(
  request: Pick<NextRequest, "url"> | URL | { url: string },
): string {
  if (request instanceof URL) {
    return request.toString();
  }

  return request.url;
}
