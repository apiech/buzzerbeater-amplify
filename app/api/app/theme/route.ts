import { NextResponse } from "next/server";

import { isThemeId } from "@/app/theme";
import { requireServerCurrentUser } from "@/app/server/amplify-server";
import { upsertServerThemePreference } from "@/app/server/theme-preferences";

export async function PUT(request: Request) {
  try {
    const currentUser = await requireServerCurrentUser();
    const body = (await request.json()) as {
      themeId?: string;
    };

    if (!isThemeId(body.themeId)) {
      return NextResponse.json(
        { data: null, errors: [{ message: "Theme id is invalid." }] },
        { status: 400 },
      );
    }

    await upsertServerThemePreference(currentUser.userId, body.themeId);
    return NextResponse.json({
      data: {
        themeId: body.themeId,
      },
    });
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
