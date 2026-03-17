import { NextResponse } from "next/server";

import { isReadName, runReadOperation } from "@/app/server/read-bff";
import { requireServerCurrentUser } from "@/app/server/amplify-server";

type RouteContext = {
  params: Promise<{
    name: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const currentUser = await requireServerCurrentUser();

    const { name } = await context.params;
    if (!isReadName(name)) {
      return NextResponse.json(
        { data: null, errors: [{ message: `Unknown read ${name}.` }] },
        { status: 404 },
      );
    }

    const body = await readOptionalBody(request);
    const result = await runReadOperation(name, currentUser.userId, body);
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
