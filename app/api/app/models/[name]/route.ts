import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isModelName, listModelRecords } from "@/app/server/amplify-bff";
import { requireServerCurrentUser } from "@/app/server/amplify-server";

type RouteContext = {
  params: Promise<{
    name: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await requireServerCurrentUser();

    const { name } = await context.params;
    if (!isModelName(name)) {
      return NextResponse.json(
        { data: null, errors: [{ message: `Unknown model ${name}.` }] },
        { status: 404 },
      );
    }

    const limit = request.nextUrl.searchParams.get("limit");
    const nextToken = request.nextUrl.searchParams.get("nextToken");
    const result = await listModelRecords(name, {
      limit: limit ? Number(limit) : undefined,
      nextToken: nextToken ?? undefined,
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
}
