import { NextResponse } from "next/server";

import {
  requireServerCurrentUser,
  type ServerCurrentUser,
} from "@/app/server/amplify-server";
import {
  createMaintenanceApiResponse,
  getServerMaintenanceState,
} from "@/app/server/maintenance";

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
    try {
      const maintenanceState = await getServerMaintenanceState();
      if (maintenanceState.active && maintenanceState.document) {
        return createMaintenanceApiResponse(maintenanceState.document);
      }

      const currentUser = await requireServerCurrentUser();
      const { name } = await context.params;
      if (!options.isOperationName(name)) {
        return NextResponse.json(
          {
            data: null,
            errors: [{ message: `Unknown ${options.label} ${name}.` }],
          },
          { status: 404 },
        );
      }

      const body = await readOptionalBody(request);
      const result = await options.runOperation({
        body,
        currentUser,
        name,
      });
      return NextResponse.json(result);
    } catch (error) {
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

  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Object.keys(parsed).length ? parsed : undefined;
}
