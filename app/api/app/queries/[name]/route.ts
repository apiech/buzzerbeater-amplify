import { NextResponse } from "next/server";

import { isQueryName, runQueryOperation } from "@/app/server/amplify-bff";
import { requireServerCurrentUser } from "@/app/server/amplify-server";
import { createMaintenanceApiResponse, getServerMaintenanceState } from "@/app/server/maintenance";

type RouteContext = {
  params: Promise<{
    name: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const maintenanceState = await getServerMaintenanceState();
    if (maintenanceState.active && maintenanceState.document) {
      return createMaintenanceApiResponse(maintenanceState.document);
    }

    await requireServerCurrentUser();

    const { name } = await context.params;
    if (!isQueryName(name)) {
      return NextResponse.json(
        { data: null, errors: [{ message: `Unknown query ${name}.` }] },
        { status: 404 },
      );
    }

    const body = await readOptionalBody(request);
    const result = await runQueryOperation(name, body);
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
}

async function readOptionalBody(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  const text = await request.text();
  if (!text.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Object.keys(parsed).length ? parsed : undefined;
}
