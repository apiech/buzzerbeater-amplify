import { NextResponse } from "next/server";

import {
  requireServerCurrentUser,
  type ServerCurrentUser,
} from "@/app/server/amplify-server";
import {
  createMaintenanceApiResponse,
  getServerMaintenanceState,
} from "@/app/server/maintenance";
import { jsonRecordSchema, parseJsonBody } from "@/lib/json-parsing";

type OperationBody = Record<string, unknown> | undefined;

export type OperationRouteContext = {
  params: Promise<{
    name: string;
  }>;
};

type AuthenticatedOperationRouteOptions<TOperationName extends string> = {
  isOperationName: (name: string) => name is TOperationName;
  label: string;
  runOperation: (args: {
    body: OperationBody;
    currentUser: ServerCurrentUser;
    name: TOperationName;
  }) => Promise<unknown>;
};

export function createAuthenticatedOperationRoute<TOperationName extends string>(
  options: AuthenticatedOperationRouteOptions<TOperationName>,
) {
  return async function POST(
    request: Request,
    context: OperationRouteContext,
  ) {
    const startedAt = Date.now();
    let body: OperationBody = undefined;
    let operationName: string | null = null;
    let currentUser: ServerCurrentUser | null = null;

    try {
      const maintenanceState = await getServerMaintenanceState();
      if (maintenanceState.active && maintenanceState.document) {
        return createMaintenanceApiResponse(maintenanceState.document);
      }

      currentUser = await requireServerCurrentUser();
      const { name } = await context.params;
      operationName = name;
      if (!options.isOperationName(name)) {
        logOperationRouteInfo("operationRoute.rejected", {
          elapsedMs: Date.now() - startedAt,
          label: options.label,
          name,
          userId: currentUser.userId,
          username: currentUser.username,
        });
        return NextResponse.json(
          {
            data: null,
            errors: [{ message: `Unknown ${options.label} ${name}.` }],
          },
          { status: 404 },
        );
      }

      body = await readOptionalBody(request);
      const bodySummary = summarizeOperationBody(name, body);
      logOperationRouteInfo("operationRoute.start", {
        ...bodySummary,
        label: options.label,
        name,
        userId: currentUser.userId,
        username: currentUser.username,
      });
      const result = await options.runOperation({
        body,
        currentUser,
        name,
      });
      logOperationRouteInfo("operationRoute.completed", {
        ...bodySummary,
        elapsedMs: Date.now() - startedAt,
        label: options.label,
        name,
        userId: currentUser.userId,
        username: currentUser.username,
      });
      return NextResponse.json(result);
    } catch (error) {
      logOperationRouteError("operationRoute.failed", {
        ...summarizeOperationBody(operationName, body),
        elapsedMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : null,
        label: options.label,
        name: operationName,
        userId: currentUser?.userId ?? null,
        username: currentUser?.username ?? null,
      });
      return NextResponse.json(
        {
          data: null,
          errors: [
            { message: error instanceof Error ? error.message : String(error) },
          ],
        },
        { status: 500 },
      );
    }
  };
}

async function readOptionalBody(request: Request): Promise<OperationBody> {
  const text = await request.text();
  if (!text.trim()) {
    return undefined;
  }

  const parsed = parseJsonBody(jsonRecordSchema, text);
  return Object.keys(parsed).length ? parsed : undefined;
}

function summarizeOperationBody(
  name: string | null,
  body: OperationBody,
): Record<string, unknown> {
  const bodyKeys = Object.keys(body ?? {}).sort();

  if (name === "connectBbAccount") {
    return {
      bbLoginName:
        typeof body?.bbLoginName === "string" ? body.bbLoginName : null,
      bodyKeys,
      hasAccessKey:
        typeof body?.accessKey === "string"
          ? body.accessKey.trim().length > 0
          : Boolean(body?.accessKey),
    };
  }

  return {
    bodyKeys,
  };
}

function logOperationRouteInfo(
  event: string,
  details: Record<string, unknown>,
): void {
  writeOperationRouteLog("INFO", event, details);
}

function logOperationRouteError(
  event: string,
  details: Record<string, unknown>,
): void {
  writeOperationRouteLog("ERROR", event, details);
}

function writeOperationRouteLog(
  level: "INFO" | "ERROR",
  event: string,
  details: Record<string, unknown>,
): void {
  const line = `[app-route] ${JSON.stringify({
    details,
    event,
    level,
    loggedAt: new Date().toISOString(),
  })}`;

  if (level === "INFO") {
    console.log(line);
    return;
  }

  console.error(line);
}
