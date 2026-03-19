import { resolvePublicAppOrigin } from "@/lib/env/public-app-origin";

export const siteOrigin = resolvePublicAppOrigin(process.env, {
  errorMessage: "APP_BASE_URL must be configured for public site metadata.",
});

export const siteUrl = new URL(siteOrigin);
