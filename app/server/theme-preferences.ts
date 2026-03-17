import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "@/app/theme";
import { serverDataClient } from "@/app/server/amplify-server";

export async function resolveServerThemeId(
  userId?: string | null,
): Promise<ThemeId> {
  if (!userId) {
    return DEFAULT_THEME_ID;
  }

  try {
    const result = await serverDataClient.models.UserPreference.get({ userId });
    const themeId = result.data?.themeId;
    return isThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export async function upsertServerThemePreference(
  userId: string,
  themeId: ThemeId,
): Promise<void> {
  const existing = await serverDataClient.models.UserPreference.get({ userId });
  if (existing.data) {
    await serverDataClient.models.UserPreference.update({
      userId,
      themeId,
    });
    return;
  }

  await serverDataClient.models.UserPreference.create({
    userId,
    themeId,
  });
}
